import Foundation

struct LogEvent: Codable, Sendable {
    let clientEventId: String
    var userIdentifier: String?
    let level: LogLevel
    let source: String?
    let body: String
    let context: String?
    let meta: [String: String]?
    let platform: OwlPlatform
    let osVersion: String?
    let appVersion: String?
    let buildNumber: String?
    let deviceModel: String?
    let locale: String?
    let timestamp: String

    enum CodingKeys: String, CodingKey {
        case clientEventId = "client_event_id"
        case userIdentifier = "user_identifier"
        case level
        case source
        case body
        case context
        case meta
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
    let events: [LogEvent]
}
