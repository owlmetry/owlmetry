import Foundation
import os

public enum Owl {
    private static let logger = Logger(subsystem: "com.owlmetry.sdk", category: "owl")

    private static var configuration: Configuration?
    private static var deviceInfo: DeviceInfo?
    private static var transport: EventTransport?
    private static var duplicateFilter: DuplicateFilter?
    private static var networkMonitor: NetworkMonitor?
    private static var offlineQueue: OfflineQueue?
    private static var defaultUserIdentifier: String?
    private static var hasWarnedNotConfigured = false

    // MARK: - Setup

    public static func configure(endpoint: String, apiKey: String) throws {
        let config = try Configuration(endpoint: endpoint, apiKey: apiKey)
        self.configuration = config
        self.deviceInfo = DeviceInfo.collect()

        let monitor = NetworkMonitor()
        self.networkMonitor = monitor

        let queue = OfflineQueue()
        self.offlineQueue = queue

        let transport = EventTransport(
            endpoint: config.endpoint,
            apiKey: config.apiKey,
            offlineQueue: queue,
            networkMonitor: monitor
        )
        self.transport = transport

        let filter = DuplicateFilter()
        self.duplicateFilter = filter

        Task {
            await transport.start()
            await filter.start()
        }
    }

    // MARK: - User Identifier

    public static func setUserIdentifier(_ identifier: String?) {
        defaultUserIdentifier = identifier
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
        var updatedMeta = meta ?? [:]
        updatedMeta["_connection"] = networkMonitor?.isConnected == true ? "connected" : "disconnected"
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
        await transport?.flush()
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
        guard let deviceInfo, let transport, let duplicateFilter else {
            if !hasWarnedNotConfigured {
                hasWarnedNotConfigured = true
                logger.warning("Owl.configure() has not been called. Events are being dropped.")
            }
            return
        }

        let event = EventBuilder.build(
            body: body,
            level: level,
            context: context,
            meta: meta,
            userIdentifier: userIdentifier ?? defaultUserIdentifier,
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
