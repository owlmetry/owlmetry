import Darwin
import Foundation
import os

public enum Owl {
    static let logSubsystem = "com.owlmetry.sdk"
    private static let logger = Logger(subsystem: logSubsystem, category: "owl")

    private struct State {
        var configuration: OwlConfiguration?
        var deviceInfo: DeviceInfo?
        var transport: EventTransport?
        var attachmentUploader: AttachmentUploader?
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
        compressionEnabled: Bool = true,
        networkTrackingEnabled: Bool = true,
        consoleLogging: Bool = true
    ) throws {
        let config = try OwlConfiguration(endpoint: endpoint, apiKey: apiKey, flushOnBackground: flushOnBackground, compressionEnabled: compressionEnabled, networkTrackingEnabled: networkTrackingEnabled, consoleLogging: consoleLogging)
        try configureWith(config)
    }

    /// Internal entry point for testing with an explicit bundle ID.
    static func configure(
        endpoint: String,
        apiKey: String,
        bundleId: String,
        flushOnBackground: Bool = true,
        compressionEnabled: Bool = true,
        networkTrackingEnabled: Bool = true,
        consoleLogging: Bool = true
    ) throws {
        let config = try OwlConfiguration(endpoint: endpoint, apiKey: apiKey, bundleId: bundleId, flushOnBackground: flushOnBackground, compressionEnabled: compressionEnabled, networkTrackingEnabled: networkTrackingEnabled, consoleLogging: consoleLogging)
        try configureWith(config)
    }

    private static func configureWith(_ config: OwlConfiguration) throws {

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
        let attachmentUploader = AttachmentUploader(
            endpoint: config.endpoint,
            apiKey: config.apiKey
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
            s.attachmentUploader = attachmentUploader
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

        // Network request instrumentation
        #if canImport(ObjectiveC)
        if config.networkTrackingEnabled {
            URLSessionInstrumentation.install(endpoint: config.endpoint)
        } else {
            URLSessionInstrumentation.disable()
        }
        #endif

        Task {
            await transport.start()
            await filter.start()
        }

        // Emit session start event with launch time if available
        var sessionAttributes: [String: String]? = nil
        if let launchMs = Self.processLaunchDurationMs() {
            sessionAttributes = ["_launch_ms": String(launchMs)]
        }
        log("sdk:session_started", level: .info, screenName: nil, attributes: sessionAttributes,
            file: #file, function: #function, line: #line)
    }

    // MARK: - Session

    /// The current session ID, or `nil` if the SDK has not been configured.
    public static var sessionId: String? {
        state.withLock { $0.sessionId }
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

    // MARK: - User Properties

    /// Set custom properties on the current user. Properties are merged
    /// server-side — existing keys not in this call are preserved.
    /// Pass an empty string value to remove a property.
    public static func setUserProperties(_ properties: [String: String]) {
        let (userId, transport) = state.withLock { s -> (String?, EventTransport?) in
            return (s.defaultUserId, s.transport)
        }
        guard let userId, let transport else { return }
        Task {
            await transport.setUserProperties(userId: userId, properties: properties)
        }
    }

    // MARK: - Logging

    public static func info(
        _ message: String,
        screenName: String? = nil,
        attributes: [String: String]? = nil,
        attachments: [OwlAttachment]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .info, screenName: screenName, attributes: attributes, attachments: attachments,
            file: file, function: function, line: line)
    }

    public static func debug(
        _ message: String,
        screenName: String? = nil,
        attributes: [String: String]? = nil,
        attachments: [OwlAttachment]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .debug, screenName: screenName, attributes: attributes, attachments: attachments,
            file: file, function: function, line: line)
    }

    public static func warn(
        _ message: String,
        screenName: String? = nil,
        attributes: [String: String]? = nil,
        attachments: [OwlAttachment]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .warn, screenName: screenName, attributes: attributes, attachments: attachments,
            file: file, function: function, line: line)
    }

    public static func error(
        _ message: String,
        screenName: String? = nil,
        attributes: [String: String]? = nil,
        attachments: [OwlAttachment]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .error, screenName: screenName, attributes: attributes, attachments: attachments,
            file: file, function: function, line: line)
    }

    // MARK: - Funnel Steps

    /// Record a funnel step. Sends an info-level event with message `"step:<stepName>"`.
    public static func step(
        _ stepName: String,
        attributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        info("step:\(stepName)", attributes: attributes, file: file, function: function, line: line)
    }

    /// Record a funnel step.
    /// - Note: Deprecated. Use `step(_:attributes:)` instead.
    @available(*, deprecated, renamed: "step(_:attributes:file:function:line:)")
    public static func track(
        _ stepName: String,
        attributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        step(stepName, attributes: attributes, file: file, function: function, line: line)
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
    ) -> OwlOperation {
        let slug = normalizeSlug(metric)
        let op = OwlOperation(metric: slug)
        var attrs = attributes ?? [:]
        attrs["tracking_id"] = op.trackingId
        info("metric:\(slug):start", attributes: attrs, file: file, function: function, line: line)
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
        info("metric:\(slug):record", attributes: attributes, file: file, function: function, line: line)
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
        #if canImport(ObjectiveC)
        URLSessionInstrumentation.disable()
        #endif
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

    private static func printToConsole(
        _ message: String,
        level: OwlLogLevel,
        attributes: [String: String]?
    ) {
        if message.hasPrefix("sdk:") { return }
        if message.hasPrefix("metric:") && message.hasSuffix(":start") { return }

        let tag: String
        switch level {
        case .info:  tag = "INFO "
        case .debug: tag = "DEBUG"
        case .warn:  tag = "WARN "
        case .error: tag = "ERROR"
        }

        let stepPrefix = "step:"
        let legacyTrackPrefix = "track:" // Legacy prefix from older SDK versions

        let displayMessage: String
        if message.hasPrefix(stepPrefix) {
            displayMessage = "step: \(String(message.dropFirst(stepPrefix.count)))"
        } else if message.hasPrefix(legacyTrackPrefix) {
            displayMessage = "step: \(String(message.dropFirst(legacyTrackPrefix.count)))"
        } else if message.hasPrefix("metric:") {
            let body = String(message.dropFirst(7))
            if let colonIndex = body.firstIndex(of: ":") {
                let metricName = body[body.startIndex..<colonIndex]
                let phase = body[body.index(after: colonIndex)...]
                displayMessage = "metric: \(metricName) \(phase)"
            } else {
                displayMessage = "metric: \(body)"
            }
        } else {
            displayMessage = message
        }

        var line = "🦉 OwlMetry \(tag) \(displayMessage)"
        if let attributes, !attributes.isEmpty {
            let pairs = attributes.sorted(by: { $0.key < $1.key }).map { "\($0.key)=\($0.value)" }.joined(separator: ", ")
            line += " {\(pairs)}"
        }

        print(line)
    }

    private static func log(
        _ message: String,
        level: OwlLogLevel,
        screenName: String?,
        attributes: [String: String]?,
        attachments: [OwlAttachment]? = nil,
        file: String,
        function: String,
        line: Int
    ) {
        let snapshot = state.withLock { s -> (DeviceInfo, EventTransport, AttachmentUploader?, DuplicateFilter, String?, String?, String, Bool)? in
            guard let deviceInfo = s.deviceInfo,
                  let transport = s.transport,
                  let filter = s.duplicateFilter,
                  let config = s.configuration else {
                if !s.hasWarnedNotConfigured {
                    s.hasWarnedNotConfigured = true
                    logger.warning("Owl.configure() has not been called. Events are being dropped.")
                }
                return nil
            }
            let networkStatus = s.networkMonitor?.status.rawValue ?? "unknown"
            return (deviceInfo, transport, s.attachmentUploader, filter, s.defaultUserId, s.sessionId, networkStatus, config.consoleLogging)
        }

        guard let (deviceInfo, transport, attachmentUploader, duplicateFilter, defaultUser, sessionId, networkStatus, consoleLogging) = snapshot else { return }

        if consoleLogging {
            printToConsole(message, level: level, attributes: attributes)
        }

        #if DEBUG
        let isDev = true
        #else
        let isDev = false
        #endif

        let event = EventBuilder.build(
            message: message,
            level: level,
            screenName: screenName,
            customAttributes: attributes,
            userId: defaultUser,
            sessionId: sessionId ?? UUID().uuidString,
            deviceInfo: deviceInfo,
            isDev: isDev,
            networkStatus: networkStatus,
            file: file,
            function: function,
            line: line
        )

        let clientEventId = event.clientEventId

        Task {
            guard await duplicateFilter.shouldAllow(event) else { return }
            await transport.enqueue(event)
        }

        if let attachments, !attachments.isEmpty, let uploader = attachmentUploader {
            Task {
                await uploader.enqueue(clientEventId: clientEventId, userId: defaultUser, isDev: isDev, attachments: attachments)
            }
        }
    }

    /// Returns milliseconds from process start to now using sysctl, or nil on failure.
    private static func processLaunchDurationMs() -> Int? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0) == 0 else { return nil }
        let startSec = Double(info.kp_proc.p_starttime.tv_sec)
        let startUsec = Double(info.kp_proc.p_starttime.tv_usec)
        let processStart = startSec + startUsec / 1_000_000
        let now = Date().timeIntervalSince1970
        let ms = Int((now - processStart) * 1000)
        return ms > 0 ? ms : nil
    }
}
