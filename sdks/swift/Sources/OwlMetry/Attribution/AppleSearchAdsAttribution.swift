import Foundation
import os

#if canImport(AdServices) && (os(iOS) || targetEnvironment(macCatalyst))
import AdServices
#endif

/// Apple Search Ads attribution capture.
///
/// Design lifted from RevenueCat's `AttributionFetcher` / `AttributionPoster`
/// (https://github.com/RevenueCat/purchases-ios/tree/main/Sources/Attribution, MIT):
///   - Fetches the AdServices attribution token off the main thread.
///   - Simulator-safe: reads `OWLMETRY_MOCK_ADSERVICES_TOKEN` env var in DEBUG
///     to let the iOS demo / UI tests exercise the full path.
///   - Optimistic persistence: marks the attempt as "captured" BEFORE the POST
///     so concurrent `configure()` calls don't double-post; clears on failure.
///   - Pending cap: Apple's record may take ~24h to populate. After 5 pending
///     responses across launches, give up (write `attribution_source="none"`)
///     to avoid retrying forever.
///
/// All state is keyed by the current anonymous id so `Owl.clearUser(newAnonymousId: true)`
/// (new install-like state) naturally resets the capture gate.
enum AppleSearchAdsAttribution {

    private static let logger = Logger(subsystem: Owl.logSubsystem, category: "attribution.asa")

    /// Maximum number of pending responses we'll chase across launches before
    /// giving up. Mirrors the server-side constant `ASA_MAX_PENDING_ATTEMPTS`.
    private static let maxPendingAttempts = 5

    private static let mockEnvVar = "OWLMETRY_MOCK_ADSERVICES_TOKEN"

    // MARK: - Public entrypoint (called from Owl.configure auto-hook and from
    // Owl.sendAppleSearchAdsAttributionToken)

    /// Attempt to capture attribution for the current install if not already
    /// captured. No-op if already done, disabled, or unsupported on this OS.
    static func captureIfNeeded(anonymousId: String, userId: String, transport: EventTransport) async {
        guard !State.isCaptured(anonymousId: anonymousId) else {
            logger.debug("Attribution already captured for \(anonymousId, privacy: .public); skipping.")
            return
        }

        guard let token = await fetchToken() else {
            // Token unavailable (simulator w/o mock, non-Apple platform, or
            // AdServices call failed). We'll retry on next configure().
            return
        }

        await submit(token: token, anonymousId: anonymousId, userId: userId, transport: transport)
    }

    /// Submit a caller-supplied token. Used by `Owl.sendAppleSearchAdsAttributionToken(_:)`
    /// (custom flows / tests). Respects the capture cache: if we already
    /// captured for this anon, we still POST but don't bump the retry counter.
    @discardableResult
    static func submit(token: String, anonymousId: String, userId: String, transport: EventTransport) async -> Bool {
        // Optimistic cache: set the flag BEFORE the POST so a concurrent
        // captureIfNeeded doesn't duplicate work. Clear only on transport failure.
        let wasAlreadyCaptured = State.isCaptured(anonymousId: anonymousId)
        State.markCaptured(anonymousId: anonymousId)

        let result = await transport.submitAppleSearchAdsAttributionToken(userId: userId, token: token)

        switch result {
        case .success:
            logger.info("Attribution submitted successfully")
            return true
        case .pending:
            // Server says "Apple record not ready yet" — don't treat as
            // captured. Bump the pending counter; if we've hit the cap, give
            // up by writing attribution_source=none and calling it done.
            if !wasAlreadyCaptured {
                State.clearCaptured(anonymousId: anonymousId)
                let attempts = State.incrementPendingAttempts(anonymousId: anonymousId)
                if attempts >= maxPendingAttempts {
                    logger.info("Attribution pending cap reached (\(attempts) attempts); giving up.")
                    await recordUnattributedAfterGiveUp(userId: userId, transport: transport)
                    State.markCaptured(anonymousId: anonymousId)
                } else {
                    logger.info("Attribution pending (attempt \(attempts)/\(maxPendingAttempts)); will retry on next launch.")
                }
            }
            return false
        case .invalidToken:
            // The server rejected the token as invalid. Not worth retrying —
            // Apple keeps the same token for the install, so a second fetch
            // gives us the same string.
            logger.warning("Attribution token rejected as invalid; not retrying.")
            return false
        case .transportFailure:
            // Transient — clear the captured flag so next launch retries.
            if !wasAlreadyCaptured {
                State.clearCaptured(anonymousId: anonymousId)
            }
            logger.warning("Attribution transport failure; will retry on next launch.")
            return false
        }
    }

    /// Write `attribution_source=none` via the existing user-properties
    /// endpoint so the "gave up" state is visible on the dashboard.
    private static func recordUnattributedAfterGiveUp(userId: String, transport: EventTransport) async {
        await transport.setUserProperties(
            userId: userId,
            properties: ["attribution_source": "none"],
        )
    }

    /// Test-only entrypoint that lets a test exercise the full capture flow
    /// against a server in `dev_mock` mode. Production code should never pass
    /// a devMock value — the real Apple fetch path is the only valid prod flow.
    @discardableResult
    static func submitForTest(
        token: String,
        anonymousId: String,
        userId: String,
        transport: EventTransport,
        devMock: String
    ) async -> Bool {
        let wasAlreadyCaptured = State.isCaptured(anonymousId: anonymousId)
        State.markCaptured(anonymousId: anonymousId)

        let result = await transport.submitAppleSearchAdsAttributionMock(
            userId: userId,
            token: token,
            devMock: devMock
        )

        switch result {
        case .success:
            return true
        case .pending:
            if !wasAlreadyCaptured {
                State.clearCaptured(anonymousId: anonymousId)
                let attempts = State.incrementPendingAttempts(anonymousId: anonymousId)
                if attempts >= maxPendingAttempts {
                    await recordUnattributedAfterGiveUp(userId: userId, transport: transport)
                    State.markCaptured(anonymousId: anonymousId)
                }
            }
            return false
        case .invalidToken:
            return false
        case .transportFailure:
            if !wasAlreadyCaptured {
                State.clearCaptured(anonymousId: anonymousId)
            }
            return false
        }
    }

    // MARK: - Token fetch (simulator-aware)

    /// Fetch the AdServices attribution token. Returns `nil` when unavailable
    /// (non-iOS, simulator without the env-var mock, or Apple's call threw).
    /// Always called off the main thread — AAAttribution forbids main-thread use.
    static func fetchToken() async -> String? {
        #if canImport(AdServices) && (os(iOS) || targetEnvironment(macCatalyst))
        if #available(iOS 14.3, macCatalyst 14.3, *) {
            return await Task.detached(priority: .background) { () -> String? in
                #if targetEnvironment(simulator)
                return simulatorToken()
                #else
                return realToken()
                #endif
            }.value
        } else {
            return nil
        }
        #else
        return nil
        #endif
    }

    #if canImport(AdServices) && (os(iOS) || targetEnvironment(macCatalyst))
    @available(iOS 14.3, macCatalyst 14.3, *)
    private static func realToken() -> String? {
        do {
            return try AAAttribution.attributionToken()
        } catch {
            logger.warning("AAAttribution.attributionToken() failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    #if targetEnvironment(simulator)
    private static func simulatorToken() -> String? {
        #if DEBUG
        if let mock = ProcessInfo.processInfo.environment[mockEnvVar], !mock.isEmpty {
            logger.info("Using mock AdServices token from \(mockEnvVar, privacy: .public)")
            return mock
        }
        #endif
        logger.info("AdServices attribution is unsupported in the simulator. Set \(mockEnvVar, privacy: .public) to mock.")
        return nil
    }
    #endif
    #endif
}

// MARK: - UserDefaults-backed capture state, keyed by anon id so
// `clearUser(newAnonymousId: true)` naturally forgets per-install state.

extension AppleSearchAdsAttribution {
    enum State {
        private static let namespace = OwlAttributionNetwork.appleSearchAds.userDefaultsNamespace

        private static func capturedKey(anonymousId: String) -> String {
            "\(namespace).captured_for_anon_\(anonymousId)"
        }
        private static func pendingAttemptsKey(anonymousId: String) -> String {
            "\(namespace).pending_attempts_for_anon_\(anonymousId)"
        }

        static func isCaptured(anonymousId: String) -> Bool {
            UserDefaults.standard.bool(forKey: capturedKey(anonymousId: anonymousId))
        }

        static func markCaptured(anonymousId: String) {
            UserDefaults.standard.set(true, forKey: capturedKey(anonymousId: anonymousId))
        }

        static func clearCaptured(anonymousId: String) {
            UserDefaults.standard.removeObject(forKey: capturedKey(anonymousId: anonymousId))
        }

        @discardableResult
        static func incrementPendingAttempts(anonymousId: String) -> Int {
            let defaults = UserDefaults.standard
            let key = pendingAttemptsKey(anonymousId: anonymousId)
            let next = defaults.integer(forKey: key) + 1
            defaults.set(next, forKey: key)
            return next
        }

        static func resetPendingAttempts(anonymousId: String) {
            UserDefaults.standard.removeObject(forKey: pendingAttemptsKey(anonymousId: anonymousId))
        }

        /// Used by tests to start from a clean slate.
        static func reset(anonymousId: String) {
            clearCaptured(anonymousId: anonymousId)
            resetPendingAttempts(anonymousId: anonymousId)
        }
    }
}
