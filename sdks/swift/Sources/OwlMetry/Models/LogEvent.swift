import Foundation

struct LogEvent: Codable, Sendable {
    let clientEventId: String
    var userId: String?
    let level: LogLevel
    let sourceModule: String?
    let message: String
    let screenName: String?
    let customAttributes: [String: String]?
    let platform: OwlPlatform
    let osVersion: String?
    let appVersion: String?
    let buildNumber: String?
    let deviceModel: String?
    let locale: String?
    let timestamp: String

    enum CodingKeys: String, CodingKey {
        case clientEventId = "client_event_id"
        case userId = "user_id"
        case level
        case sourceModule = "source_module"
        case message
        case screenName = "screen_name"
        case customAttributes = "custom_attributes"
        case platform
        case osVersion = "os_version"
        case appVersion = "app_version"
        case buildNumber = "build_number"
        case deviceModel = "device_model"
        case locale
        case timestamp
    }
}

struct IngestRequestBody: Codable, Sendable {
    let bundle_id: String
    let events: [LogEvent]
}
