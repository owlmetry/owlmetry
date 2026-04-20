import Foundation

/// A file to upload alongside an error event so engineers can reproduce the bug from the
/// original bytes. Attachments are a **limited resource** — each project has a storage
/// quota (default 5 GB, configurable) and each file has a per-file size limit (default
/// 250 MB). Only attach files when the bytes themselves are essential — e.g. the input
/// image for a failed media conversion, a model file that failed to parse. Do NOT attach
/// files to routine errors whose cause is obvious from the message or breadcrumbs.
///
/// Uploads are best-effort: failure never affects the host app, and the event still posts
/// normally even if its attachment upload is rejected or the device is offline.
public struct OwlAttachment: Sendable {
    public enum Source: Sendable {
        case fileURL(URL)
        case data(Data)
    }

    public let source: Source
    public let name: String
    public let contentType: String?

    /// Attach a file from disk. The filename is used on the server for downloads; the
    /// content type is inferred from the file extension when not provided.
    public init(fileURL: URL, name: String? = nil, contentType: String? = nil) {
        self.source = .fileURL(fileURL)
        self.name = name ?? fileURL.lastPathComponent
        self.contentType = contentType
    }

    /// Attach in-memory bytes. Provide a sensible filename and content type.
    public init(data: Data, name: String, contentType: String? = nil) {
        self.source = .data(data)
        self.name = name
        self.contentType = contentType
    }
}
