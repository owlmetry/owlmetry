import Foundation

public struct Configuration: Sendable {
    let endpoint: URL
    let apiKey: String
    let flushOnBackground: Bool

    private static let clientKeyPrefix = "owl_client_"

    public init(endpoint: String, apiKey: String, flushOnBackground: Bool = true) throws {
        guard let url = URL(string: endpoint) else {
            throw ConfigurationError.invalidEndpoint(endpoint)
        }
        guard apiKey.hasPrefix(Self.clientKeyPrefix) else {
            throw ConfigurationError.invalidApiKey("API key must start with \"\(Self.clientKeyPrefix)\"")
        }
        self.endpoint = url
        self.apiKey = apiKey
        self.flushOnBackground = flushOnBackground
    }
}

public enum ConfigurationError: LocalizedError {
    case invalidEndpoint(String)
    case invalidApiKey(String)

    public var errorDescription: String? {
        switch self {
        case .invalidEndpoint(let value):
            return "Invalid endpoint URL: \(value)"
        case .invalidApiKey(let message):
            return message
        }
    }
}
