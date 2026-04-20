import Foundation
import CommonCrypto
import UniformTypeIdentifiers
import os

actor AttachmentUploader {
    private let ingestAttachmentURL: URL
    private let apiKey: String
    private let session: URLSession
    private let sdkHardCapBytes: Int
    private var queue: Task<Void, Never>?
    private var pending: [PendingUpload] = []

    private struct PendingUpload {
        let clientEventId: String
        let userId: String?
        let isDev: Bool
        let attachment: OwlAttachment
    }

    private struct ReserveResponse: Decodable {
        let attachment_id: String
        let upload_url: String
    }

    private static let logger = Logger(subsystem: Owl.logSubsystem, category: "attachments")
    // Absolute SDK safety net (2 GB). Real enforcement is server-side against the
    // project's per-user and project quotas.
    private static let defaultSdkHardCapBytes = 2 * 1024 * 1024 * 1024

    init(
        endpoint: URL,
        apiKey: String,
        sdkHardCapBytes: Int = AttachmentUploader.defaultSdkHardCapBytes,
        session: URLSession = .shared
    ) {
        self.ingestAttachmentURL = endpoint.appendingPathComponent("v1/ingest/attachment")
        self.apiKey = apiKey
        self.sdkHardCapBytes = sdkHardCapBytes
        self.session = session
    }

    func enqueue(clientEventId: String, userId: String?, isDev: Bool, attachments: [OwlAttachment]) {
        for attachment in attachments {
            pending.append(PendingUpload(clientEventId: clientEventId, userId: userId, isDev: isDev, attachment: attachment))
        }
        if queue == nil {
            queue = Task { [weak self] in
                await self?.drain()
            }
        }
    }

    private func drain() async {
        while !pending.isEmpty {
            let next = pending.removeFirst()
            await uploadOne(next)
        }
        queue = nil
    }

    private func uploadOne(_ item: PendingUpload) async {
        let (bytes, contentType): (Data, String)
        do {
            (bytes, contentType) = try loadBytes(for: item.attachment)
        } catch {
            Self.logger.warning("Failed to load attachment \"\(item.attachment.name)\": \(error.localizedDescription)")
            return
        }

        if bytes.count == 0 {
            Self.logger.warning("Skipping empty attachment \"\(item.attachment.name)\"")
            return
        }
        if bytes.count > sdkHardCapBytes {
            Self.logger.warning("Attachment \"\(item.attachment.name)\" is \(bytes.count) bytes, exceeds SDK hard cap \(self.sdkHardCapBytes). Skipping upload.")
            return
        }

        let sha = sha256Hex(bytes)
        guard let reserve = await reserve(
            clientEventId: item.clientEventId,
            userId: item.userId,
            filename: item.attachment.name,
            contentType: contentType,
            sizeBytes: bytes.count,
            sha256: sha,
            isDev: item.isDev
        ) else {
            return
        }

        guard let uploadUrl = URL(string: reserve.upload_url) else {
            Self.logger.warning("Attachment reservation returned invalid upload URL")
            return
        }

        await put(url: uploadUrl, body: bytes, attachmentName: item.attachment.name)
    }

    private func reserve(
        clientEventId: String,
        userId: String?,
        filename: String,
        contentType: String,
        sizeBytes: Int,
        sha256: String,
        isDev: Bool
    ) async -> ReserveResponse? {
        var body: [String: Any] = [
            "client_event_id": clientEventId,
            "original_filename": filename,
            "content_type": contentType,
            "size_bytes": sizeBytes,
            "sha256": sha256,
            "is_dev": isDev,
        ]
        if let userId = userId {
            body["user_id"] = userId
        }
        guard let httpBody = try? JSONSerialization.data(withJSONObject: body) else {
            return nil
        }

        var request = URLRequest(url: ingestAttachmentURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = httpBody

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return nil }
            if (200..<300).contains(http.statusCode) {
                return try? JSONDecoder().decode(ReserveResponse.self, from: data)
            }
            Self.logger.warning("Attachment reserve for \(filename) rejected (\(http.statusCode))")
            return nil
        } catch {
            Self.logger.warning("Attachment reserve network error: \(error.localizedDescription)")
            return nil
        }
    }

    private func put(url: URL, body: Data, attachmentName: String) async {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        for attempt in 0..<2 {
            do {
                let (_, response) = try await session.upload(for: request, from: body)
                guard let http = response as? HTTPURLResponse else { return }
                if (200..<300).contains(http.statusCode) {
                    return
                }
                if (400..<500).contains(http.statusCode) {
                    Self.logger.warning("Attachment upload for \(attachmentName) rejected (\(http.statusCode))")
                    return
                }
                Self.logger.warning("Attachment upload for \(attachmentName) returned \(http.statusCode), attempt \(attempt + 1)")
            } catch {
                Self.logger.warning("Attachment upload network error: \(error.localizedDescription)")
            }
        }
    }

    private func loadBytes(for attachment: OwlAttachment) throws -> (Data, String) {
        switch attachment.source {
        case .data(let bytes):
            return (bytes, attachment.contentType ?? defaultContentType(for: attachment.name))
        case .fileURL(let url):
            let data = try Data(contentsOf: url)
            return (data, attachment.contentType ?? defaultContentType(for: url.lastPathComponent))
        }
    }

    private func defaultContentType(for filename: String) -> String {
        let ext = (filename as NSString).pathExtension
        guard !ext.isEmpty,
              let type = UTType(filenameExtension: ext),
              let mime = type.preferredMIMEType
        else {
            return "application/octet-stream"
        }
        return mime
    }

    private func sha256Hex(_ data: Data) -> String {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { buffer in
            _ = CC_SHA256(buffer.baseAddress, CC_LONG(buffer.count), &hash)
        }
        return hash.map { String(format: "%02x", $0) }.joined()
    }
}
