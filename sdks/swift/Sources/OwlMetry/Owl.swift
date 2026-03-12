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
        var defaultUserIdentifier: String?
        var anonymousId: String?
        var hasWarnedNotConfigured = false
    }

    private static let state = OSAllocatedUnfairLock(initialState: State())

    // MARK: - Setup

    public static func configure(endpoint: String, apiKey: String) throws {
        let config = try Configuration(endpoint: endpoint, apiKey: apiKey)

        let monitor = NetworkMonitor()
        let queue = OfflineQueue()
        let transport = EventTransport(
            endpoint: config.endpoint,
            apiKey: config.apiKey,
            offlineQueue: queue,
            networkMonitor: monitor
        )
        let filter = DuplicateFilter()

        // Resolve identity: saved real user ID > anonymous ID
        let anonId = IdentityManager.anonymousId()
        let userId = IdentityManager.savedUserId() ?? anonId

        let oldTransport: EventTransport? = state.withLock { s in
            let old = s.transport
            s.configuration = config
            s.deviceInfo = DeviceInfo.collect()
            s.networkMonitor = monitor
            s.offlineQueue = queue
            s.transport = transport
            s.duplicateFilter = filter
            s.anonymousId = anonId
            s.defaultUserIdentifier = userId
            s.hasWarnedNotConfigured = false
            return old
        }

        // Flush old transport before replacing
        if let oldTransport {
            Task { await oldTransport.shutdown() }
        }

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
            s.defaultUserIdentifier = identifier
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
                s.defaultUserIdentifier = freshId
            } else {
                s.defaultUserIdentifier = s.anonymousId
            }
        }
    }

    // MARK: - Logging

    public static func info(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .info, context: context, meta: meta,
            file: file, function: function, line: line)
    }

    public static func debug(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .debug, context: context, meta: meta,
            file: file, function: function, line: line)
    }

    public static func warn(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .warn, context: context, meta: meta,
            file: file, function: function, line: line)
    }

    public static func error(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        let connected = state.withLock { $0.networkMonitor?.isConnected == true }
        var updatedMeta = meta ?? [:]
        updatedMeta["_connection"] = connected ? "connected" : "disconnected"
        log(body, level: .error, context: context, meta: updatedMeta,
            file: file, function: function, line: line)
    }

    public static func attention(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .attention, context: context, meta: meta,
            file: file, function: function, line: line)
    }

    public static func tracking(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .tracking, context: context, meta: meta,
            file: file, function: function, line: line)
    }

    // MARK: - Funnel Tracking

    public static func track(
        _ name: String,
        meta: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(name, level: .tracking, context: nil, meta: meta,
            file: file, function: function, line: line)
    }

    public static func once(
        _ name: String,
        meta: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        guard !FunnelTracker.hasTrackedOnce(name) else { return }
        FunnelTracker.markTrackedOnce(name)
        track(name, meta: meta, file: file, function: function, line: line)
    }

    // MARK: - Lifecycle

    public static func shutdown() async {
        let transport = state.withLock { $0.transport }
        await transport?.shutdown()
    }

    // MARK: - Internal

    private static func log(
        _ body: String,
        level: LogLevel,
        context: String?,
        meta: [String: String]?,
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
            return (deviceInfo, transport, filter, s.defaultUserIdentifier)
        }

        guard let (deviceInfo, transport, duplicateFilter, defaultUser) = snapshot else { return }

        let event = EventBuilder.build(
            body: body,
            level: level,
            context: context,
            meta: meta,
            userIdentifier: defaultUser,
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
