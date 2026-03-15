import Foundation

enum EventBuilder {
    static let systemMetaKeys: Set<String> = ["_file", "_function", "_line"]

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func build(
        message: String,
        level: LogLevel,
        screenName: String?,
        customAttributes: [String: String]?,
        userId: String?,
        sessionId: String,
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

        var mergedAttributes = CustomAttributeTrimmer.trim(customAttributes) ?? [:]
        mergedAttributes["_file"] = fileName
        mergedAttributes["_function"] = function
        mergedAttributes["_line"] = String(line)

        return LogEvent(
            clientEventId: UUID().uuidString,
            sessionId: sessionId,
            userId: userId,
            level: level,
            sourceModule: "\(fileName):\(function):\(line)",
            message: message,
            screenName: screenName,
            customAttributes: mergedAttributes.isEmpty ? nil : mergedAttributes,
            environment: deviceInfo.platform,
            osVersion: deviceInfo.osVersion,
            appVersion: deviceInfo.appVersion,
            buildNumber: deviceInfo.buildNumber,
            deviceModel: deviceInfo.deviceModel,
            locale: deviceInfo.locale,
            timestamp: isoFormatter.string(from: Date())
        )
    }
}
