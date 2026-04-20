import Foundation

/// A file to upload alongside an error event. See docs/concepts/attachments.
public struct OwlAttachment: Sendable {
    public enum Source: Sendable {
        case fileURL(URL)
        case data(Data)
    }

    public let source: Source
    public let name: String
    public let contentType: String?

    public init(fileURL: URL, name: String? = nil, contentType: String? = nil) {
        self.source = .fileURL(fileURL)
        self.name = name ?? fileURL.lastPathComponent
        self.contentType = contentType
    }

    public init(data: Data, name: String, contentType: String? = nil) {
        self.source = .data(data)
        self.name = name
        self.contentType = contentType
    }
}
