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

        let monitor = NetworkMonitor()
        let queue = OfflineQueue()
        let transport = EventTransport(
            endpoint: config.endpoint,
            apiKey: config.apiKey,
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
        let connected = state.withLock { $0.networkMonitor?.isConnected == true }
        var updatedAttributes = customAttributes ?? [:]
        updatedAttributes["_connection"] = connected ? "connected" : "disconnected"
        log(message, level: .error, screenName: screenName, customAttributes: updatedAttributes,
            file: file, function: function, line: line)
    }

    public static func attention(
        _ message: String,
        screenName: String? = nil,
        customAttributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .attention, screenName: screenName, customAttributes: customAttributes,
            file: file, function: function, line: line)
    }

    public static func tracking(
        _ message: String,
        screenName: String? = nil,
        customAttributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(message, level: .tracking, screenName: screenName, customAttributes: customAttributes,
            file: file, function: function, line: line)
    }

    // MARK: - Funnel Tracking

    public static func track(
        _ name: String,
        customAttributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(name, level: .tracking, screenName: nil, customAttributes: customAttributes,
            file: file, function: function, line: line)
    }

    public static func trackOnce(
        _ name: String,
        customAttributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        guard !FunnelTracker.hasTrackedOnce(name) else { return }
        FunnelTracker.markTrackedOnce(name)
        track(name, customAttributes: customAttributes, file: file, function: function, line: line)
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
        let snapshot = state.withLock { s -> (DeviceInfo, EventTransport, DuplicateFilter, String?)? in
            guard let deviceInfo = s.deviceInfo,
                  let transport = s.transport,
                  let filter = s.duplicateFilter else {
                if !s.hasWarnedNotConfigured {
                    s.hasWarnedNotConfigured = true
                    logger.warning("Owl.configure() has not been called. Events are being dropped.")
                }
                return nil
            }
            return (deviceInfo, transport, filter, s.defaultUserId)
        }

        guard let (deviceInfo, transport, duplicateFilter, defaultUser) = snapshot else { return }

        let event = EventBuilder.build(
            message: message,
            level: level,
            screenName: screenName,
            customAttributes: customAttributes,
            userId: defaultUser,
            deviceInfo: deviceInfo,
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
