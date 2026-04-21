import Foundation

/// Confirmation returned by the server after feedback is accepted.
public struct OwlFeedbackReceipt: Sendable, Equatable {
    public let id: String
    public let createdAt: Date

    public init(id: String, createdAt: Date) {
        self.id = id
        self.createdAt = createdAt
    }
}

/// Errors thrown by `Owl.sendFeedback`.
public enum OwlFeedbackError: Error, LocalizedError, Equatable {
    /// `Owl.configure` has not been called yet.
    case notConfigured
    /// The message parameter was empty or only whitespace.
    case emptyMessage
    /// The server responded with a non-2xx status. Body is returned verbatim for debugging.
    case serverError(statusCode: Int, body: String?)
    /// A transport-level failure (network unreachable, invalid response, decode error).
    case transportFailure(String)

    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "OwlMetry is not configured. Call Owl.configure(...) before sending feedback."
        case .emptyMessage:
            return "Feedback message is empty."
        case .serverError(let code, let body):
            if let body, !body.isEmpty { return "Server returned \(code): \(body)" }
            return "Server returned \(code)"
        case .transportFailure(let msg):
            return msg
        }
    }
}
