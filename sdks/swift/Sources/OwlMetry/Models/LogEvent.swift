import Foundation

struct LogEvent: Codable, Sendable {
    let clientEventId: String
    let sessionId: String
    var userId: String?
    let level: OwlLogLevel
    let sourceModule: String?
    let message: String
    let screenName: String?
    let customAttributes: [String: String]?
    let environment: OwlPlatform
    let osVersion: String?
    let appVersion: String?
    let buildNumber: String?
    let deviceModel: String?
    let locale: String?
    let isDev: Bool
    let experiments: [String: String]?
    let timestamp: String

    enum CodingKeys: String, CodingKey {
        case clientEventId = "client_event_id"
        case sessionId = "session_id"
        case userId = "user_id"
        case level
        case sourceModule = "source_module"
        case message
        case screenName = "screen_name"
        case customAttributes = "custom_attributes"
        case environment
        case osVersion = "os_version"
        case appVersion = "app_version"
        case buildNumber = "build_number"
        case deviceModel = "device_model"
        case locale
        case isDev = "is_dev"
        case experiments
        case timestamp
    }
}

struct IngestRequestBody: Codable, Sendable {
    let bundle_id: String
    let events: [LogEvent]
}

struct FeedbackRequestBody: Codable, Sendable {
    let bundle_id: String
    let message: String
    let session_id: String?
    let user_id: String?
    let submitter_name: String?
    let submitter_email: String?
    let app_version: String?
    let environment: String?
    let device_model: String?
    let os_version: String?
    let is_dev: Bool
}

struct FeedbackResponseBody: Codable, Sendable {
    let id: String
    let created_at: String
}
