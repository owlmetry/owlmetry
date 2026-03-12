import Foundation

enum EventBuilder {
    static let systemMetaKeys: Set<String> = ["_file", "_function", "_line"]

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func build(
        body: String,
        level: LogLevel,
        context: String?,
        meta: [String: String]?,
        userIdentifier: String?,
        deviceInfo: DeviceInfo,
        file: String,
        function: String,
        line: Int
    ) -> LogEvent {
        let fileName: String
        if let lastSlash = file.lastIndex(of: "/") {
            fileName = String(file[file.index(after: lastSlash)...])
        } else {
            fileName = file
        }

        var mergedMeta = MetaTrimmer.trim(meta) ?? [:]
        mergedMeta["_file"] = fileName
        mergedMeta["_function"] = function
        mergedMeta["_line"] = String(line)

        return LogEvent(
            clientEventId: UUID().uuidString,
            userIdentifier: userIdentifier,
            level: level,
            source: "\(fileName):\(function):\(line)",
            body: body,
            context: context,
            meta: mergedMeta.isEmpty ? nil : mergedMeta,
            platform: deviceInfo.platform,
            osVersion: deviceInfo.osVersion,
            appVersion: deviceInfo.appVersion,
            buildNumber: deviceInfo.buildNumber,
            deviceModel: deviceInfo.deviceModel,
            locale: deviceInfo.locale,
            timestamp: isoFormatter.string(from: Date())
        )
    }
}
