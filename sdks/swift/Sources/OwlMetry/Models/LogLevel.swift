import Foundation

public enum LogLevel: String, Codable, Sendable {
    case info
    case debug
    case warn
    case error
    case attention
}
