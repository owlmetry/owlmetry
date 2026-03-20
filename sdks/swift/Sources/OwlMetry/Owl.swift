import Foundation
import os

public enum Owl {
    static let logSubsystem = "com.owlmetry.sdk"
    private static let logger = Logger(subsystem: logSubsystem, category: "owl")

    private struct State {
        var configuration: Configuration?
        var deviceInfo: DeviceInfo?
        var transport: EventTransport?
        var duplicateFilter: DuplicateFilter?
        var networkMonitor: NetworkMonitor?
        var offlineQueue: OfflineQueue?
        var lifecycleObserver: LifecycleObserver?
        var defaultUserId: String?
        var anonymousId: String?
        var sessionId: String?
        var hasWarnedNotConfigured = false
    }

    private static let state = OSAllocatedUnfairLock(initialState: State())

    // MARK: - Setup

    public static func configure(
        endpoint: String,
        apiKey: String,
        flushOnBackground: Bool = true,
        compressionEnabled: Bool = true
    ) throws {
        let config = try Configuration(endpoint: endpoint, apiKey: apiKey, flushOnBackground: flushOnBackground, compressionEnabled: compressionEnabled)
        try configureWith(config)
    }

    /// Internal entry point for testing with an explicit bundle ID.
    static func configure(
        endpoint: String,
        apiKey: String,
        bundleId: String,
        flushOnBackground: Bool = true,
        compressionEnabled: Bool = true
    ) throws {
        let config = try Configuration(endpoint: endpoint, apiKey: apiKey, bundleId: bundleId, flushOnBackground: flushOnBackground, compressionEnabled: compressionEnabled)
        try configureWith(config)
    }

    private static func configureWith(_ config: Configuration) throws {

        let monitor = NetworkMonitor()
        let queue = OfflineQueue()
        let transport = EventTransport(
            endpoint: config.endpoint,
            apiKey: config.apiKey,
            bundleId: config.bundleId,
            compressionEnabled: config.compressionEnabled,
            offlineQueue: queue,
            networkMonitor: monitor
        )
        let filter = DuplicateFilter()

        // Resolve identity: saved real user ID > anonymous ID
        let anonId = IdentityManager.anonymousId()
        let userId = IdentityManager.savedUserId() ?? anonId

        let lifecycleObserver: LifecycleObserver?
        if config.flushOnBackground {
            lifecycleObserver = LifecycleObserver(transport: transport, offlineQueue: queue)
        } else {
            lifecycleObserver = nil
        }

        let (oldTransport, oldObserver): (EventTransport?, LifecycleObserver?) = state.withLock { s in
            let old = (s.transport, s.lifecycleObserver)
            s.configuration = config
            s.deviceInfo = DeviceInfo.collect()
            s.networkMonitor = monitor
            s.offlineQueue = queue
            s.transport = transport
            s.duplicateFilter = filter
            s.lifecycleObserver = lifecycleObserver
            s.anonymousId = anonId
            s.sessionId = UUID().uuidString
            s.defaultUserId = userId
            s.hasWarnedNotConfigured = false
            return old
        }

        // Stop old observer and flush old transport before replacing
        oldObserver?.stop()
        if let oldTransport {
            Task { await oldTransport.shutdown() }
        }

        lifecycleObserver?.start()

        Task {
            await transport.start()
            await filter.start()
        }
    }

    // MARK: - User Identity

    /// Set the real user identifier (call after your app's login).
    /// This persists the ID and triggers a server-side claim to
    /// retroactively associate all anonymous events with this user.
    public static func setUser(_ identifier: String) {
        IdentityManager.saveUserId(identifier)

        let (anonId, transport) = state.withLock { s -> (String?, EventTransport?) in
            let anonId = s.anonymousId
            s.defaultUserId = identifier
            return (anonId, s.transport)
        }

        // Fire claim request to update previously-sent anonymous events
        if let anonId, let transport {
            Task {
                await transport.claimIdentity(anonymousId: anonId, userId: identifier)
            }
        }
    }

    /// Clear the user identifier (call on logout).
    /// Reverts to the anonymous device ID for future events.
    /// Pass `newAnonymousId: true` to generate a fresh anonymous ID
    /// (use when the device may be shared between users).
    public static func clearUser(newAnonymousId: Bool = false) {
        IdentityManager.clearUserId()

        // Generate new anonymous ID outside the lock (Keychain I/O)
        let freshId = newAnonymousId ? IdentityManager.resetAnonymousId() : nil

        state.withLock { s in
            if let freshId {
                s.anonymousId = freshId
                s.defaultUserId = freshId
            } else {
                s.defaultUserId = s.anonymousId
            }
        }
    }

    // MARK: - Logging

    public static func info(
        _ message: String,
        screenName: String? = nil,
        customAttributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .info, screenName: screenName, customAttributes: customAttributes,
            file: file, function: function, line: line)
    }

    public static func debug(
        _ message: String,
        screenName: String? = nil,
        customAttributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .debug, screenName: screenName, customAttributes: customAttributes,
            file: file, function: function, line: line)
    }

    public static func warn(
        _ message: String,
        screenName: String? = nil,
        customAttributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .warn, screenName: screenName, customAttributes: customAttributes,
            file: file, function: function, line: line)
    }

    public static func error(
        _ message: String,
        screenName: String? = nil,
        customAttributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .error, screenName: screenName, customAttributes: customAttributes,
            file: file, function: function, line: line)
    }

    // MARK: - Funnel Tracking

    /// Track a funnel step. Sends an info-level event with message `"track:<stepName>"`.
    public static func track(
        _ stepName: String,
        attributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        info("track:\(stepName)", customAttributes: attributes, file: file, function: function, line: line)
    }

    // MARK: - Experiments

    /// Returns the variant assigned for the given experiment name. On the first call for a given
    /// name, a random variant is picked from `options` and persisted to the Keychain. Subsequent
    /// calls return the stored variant — the `options` parameter is ignored after assignment.
    @discardableResult
    public static func getVariant(_ name: String, options: [String]) -> String {
        ExperimentManager.shared.getVariant(name, options: options)
    }

    /// Force a specific variant for an experiment (e.g. from a server-side assignment).
    public static func setExperiment(_ name: String, variant: String) {
        ExperimentManager.shared.setExperiment(name, variant: variant)
    }

    /// Reset all experiment assignments, clearing them from the Keychain.
    public static func clearExperiments() {
        ExperimentManager.shared.clearAll()
    }

    // MARK: - Structured Metrics

    /// Regex for valid metric slugs: lowercase letters, numbers, and hyphens only.
    private static let slugRegex = try! NSRegularExpression(pattern: "^[a-z0-9-]+$")

    /// Normalize a metric slug to contain only lowercase letters, numbers, and hyphens.
    /// Logs a warning if the slug was modified.
    private static func normalizeSlug(_ slug: String) -> String {
        let range = NSRange(slug.startIndex..., in: slug)
        if slugRegex.firstMatch(in: slug, range: range) != nil {
            return slug
        }
        var normalized = slug.lowercased()
        normalized = normalized.replacingOccurrences(
            of: "[^a-z0-9-]", with: "-", options: .regularExpression)
        normalized = normalized.replacingOccurrences(
            of: "-{2,}", with: "-", options: .regularExpression)
        normalized = normalized.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        logger.warning("Metric slug \"\(slug)\" was auto-corrected to \"\(normalized)\". Slugs should contain only lowercase letters, numbers, and hyphens.")
        return normalized
    }

    /// Start a tracked operation. Returns an `Operation` object whose `complete()`, `fail()`,
    /// or `cancel()` method should be called when the operation finishes.
    ///
    /// The `metric` slug should contain only lowercase letters, numbers, and hyphens
    /// (e.g. `"photo-conversion"`, `"api-request"`). Invalid characters are auto-corrected
    /// with a warning logged.
    public static func startOperation(
        _ metric: String,
        attributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) -> Operation {
        let slug = normalizeSlug(metric)
        let op = Operation(metric: slug)
        var attrs = attributes ?? [:]
        attrs["tracking_id"] = op.trackingId
        info("metric:\(slug):start", customAttributes: attrs, file: file, function: function, line: line)
        return op
    }

    /// Record a single-shot metric (no lifecycle).
    ///
    /// The `metric` slug should contain only lowercase letters, numbers, and hyphens
    /// (e.g. `"onboarding"`, `"checkout"`). Invalid characters are auto-corrected
    /// with a warning logged.
    public static func recordMetric(
        _ metric: String,
        attributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        let slug = normalizeSlug(metric)
        info("metric:\(slug):record", customAttributes: attributes, file: file, function: function, line: line)
    }

    // MARK: - Lifecycle

    public static func shutdown() async {
        let (transport, observer) = state.withLock { ($0.transport, $0.lifecycleObserver) }
        observer?.stop()
        await transport?.shutdown()
    }

    // MARK: - Testing Support

    /// Reset all SDK state, simulating an app restart.
    /// After calling this, `configure()` must be called again.
    /// Persistent state (Keychain anonymous ID, UserDefaults) is NOT cleared,
    /// matching real app restart behavior.
    static func reset() async {
        let (oldTransport, oldObserver) = state.withLock { s -> (EventTransport?, LifecycleObserver?) in
            let old = (s.transport, s.lifecycleObserver)
            s = State()
            return old
        }
        oldObserver?.stop()
        await oldTransport?.shutdown()
    }

    /// Access the offline queue for testing.
    static var _offlineQueue: OfflineQueue? {
        state.withLock { $0.offlineQueue }
    }

    // MARK: - Internal

    private static func log(
        _ message: String,
        level: LogLevel,
        screenName: String?,
        customAttributes: [String: String]?,
        file: String,
        function: String,
        line: Int
    ) {
        let snapshot = state.withLock { s -> (DeviceInfo, EventTransport, DuplicateFilter, String?, String?, String)? in
            guard let deviceInfo = s.deviceInfo,
                  let transport = s.transport,
                  let filter = s.duplicateFilter else {
                if !s.hasWarnedNotConfigured {
                    s.hasWarnedNotConfigured = true
                    logger.warning("Owl.configure() has not been called. Events are being dropped.")
                }
                return nil
            }
            let networkStatus = s.networkMonitor?.status.rawValue ?? "unknown"
            return (deviceInfo, transport, filter, s.defaultUserId, s.sessionId, networkStatus)
        }

        guard let (deviceInfo, transport, duplicateFilter, defaultUser, sessionId, networkStatus) = snapshot else { return }

        #if DEBUG
        let isDev = true
        #else
        let isDev = false
        #endif

        let event = EventBuilder.build(
            message: message,
            level: level,
            screenName: screenName,
            customAttributes: customAttributes,
            userId: defaultUser,
            sessionId: sessionId ?? UUID().uuidString,
            deviceInfo: deviceInfo,
            isDev: isDev,
            networkStatus: networkStatus,
            file: file,
            function: function,
            line: line
        )

        Task {
            guard await duplicateFilter.shouldAllow(event) else { return }
            await transport.enqueue(event)
        }
    }
}
