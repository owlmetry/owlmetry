import Foundation

public struct Configuration: Sendable {
    let endpoint: URL
    let apiKey: String
    let bundleId: String
    let flushOnBackground: Bool
    let compressionEnabled: Bool
    let networkTrackingEnabled: Bool

    private static let clientKeyPrefix = "owl_client_"

    public init(endpoint: String, apiKey: String, flushOnBackground: Bool = true, compressionEnabled: Bool = true, networkTrackingEnabled: Bool = true) throws {
        guard let bundleId = Bundle.main.bundleIdentifier, !bundleId.isEmpty else {
            throw ConfigurationError.missingBundleId
        }
        try self.init(endpoint: endpoint, apiKey: apiKey, bundleId: bundleId, flushOnBackground: flushOnBackground, compressionEnabled: compressionEnabled, networkTrackingEnabled: networkTrackingEnabled)
    }

    /// Internal initializer for testing with an explicit bundle ID.
    init(endpoint: String, apiKey: String, bundleId: String, flushOnBackground: Bool = true, compressionEnabled: Bool = true, networkTrackingEnabled: Bool = true) throws {
        guard let url = URL(string: endpoint) else {
            throw ConfigurationError.invalidEndpoint(endpoint)
        }
        guard apiKey.hasPrefix(Self.clientKeyPrefix) else {
            throw ConfigurationError.invalidApiKey("API key must start with \"\(Self.clientKeyPrefix)\"")
        }
        guard !bundleId.isEmpty else {
            throw ConfigurationError.missingBundleId
        }
        self.endpoint = url
        self.apiKey = apiKey
        self.bundleId = bundleId
        self.flushOnBackground = flushOnBackground
        self.compressionEnabled = compressionEnabled
        self.networkTrackingEnabled = networkTrackingEnabled
    }
}

public enum ConfigurationError: LocalizedError {
    case invalidEndpoint(String)
    case invalidApiKey(String)
    case missingBundleId

    public var errorDescription: String? {
        switch self {
        case .invalidEndpoint(let value):
            return "Invalid endpoint URL: \(value)"
        case .invalidApiKey(let message):
            return message
        case .missingBundleId:
            return "Bundle ID could not be determined. Ensure the app has a valid bundle identifier."
        }
    }
}
