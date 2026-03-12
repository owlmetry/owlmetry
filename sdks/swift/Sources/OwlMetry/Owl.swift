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

        let oldTransport: EventTransport? = state.withLock { s in
            let old = s.transport
            s.configuration = config
            s.deviceInfo = DeviceInfo.collect()
            s.networkMonitor = monitor
            s.offlineQueue = queue
            s.transport = transport
            s.duplicateFilter = filter
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

    // MARK: - User Identifier

    public static func setUserIdentifier(_ identifier: String?) {
        state.withLock { $0.defaultUserIdentifier = identifier }
    }

    // MARK: - Logging

    public static func info(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        userIdentifier: String? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .info, context: context, meta: meta, userIdentifier: userIdentifier,
            file: file, function: function, line: line)
    }

    public static func debug(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        userIdentifier: String? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .debug, context: context, meta: meta, userIdentifier: userIdentifier,
            file: file, function: function, line: line)
    }

    public static func warn(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        userIdentifier: String? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .warn, context: context, meta: meta, userIdentifier: userIdentifier,
            file: file, function: function, line: line)
    }

    public static func error(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        userIdentifier: String? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        let connected = state.withLock { $0.networkMonitor?.isConnected == true }
        var updatedMeta = meta ?? [:]
        updatedMeta["_connection"] = connected ? "connected" : "disconnected"
        log(body, level: .error, context: context, meta: updatedMeta, userIdentifier: userIdentifier,
            file: file, function: function, line: line)
    }

    public static func attention(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        userIdentifier: String? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .attention, context: context, meta: meta, userIdentifier: userIdentifier,
            file: file, function: function, line: line)
    }

    public static func tracking(
        _ body: String,
        context: String? = nil,
        meta: [String: String]? = nil,
        userIdentifier: String? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(body, level: .tracking, context: context, meta: meta, userIdentifier: userIdentifier,
            file: file, function: function, line: line)
    }

    // MARK: - Funnel Tracking

    public static func track(
        _ name: String,
        meta: [String: String]? = nil,
        userIdentifier: String? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(name, level: .tracking, context: nil, meta: meta, userIdentifier: userIdentifier,
            file: file, function: function, line: line)
    }

    public static func once(
        _ name: String,
        meta: [String: String]? = nil,
        userIdentifier: String? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        guard !FunnelTracker.hasTrackedOnce(name) else { return }
        FunnelTracker.markTrackedOnce(name)
        track(name, meta: meta, userIdentifier: userIdentifier,
              file: file, function: function, line: line)
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
        userIdentifier: String?,
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
            userIdentifier: userIdentifier ?? defaultUser,
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
