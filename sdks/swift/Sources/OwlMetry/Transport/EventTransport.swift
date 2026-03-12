import Foundation
import os

actor EventTransport {
    private var buffer: [LogEvent] = []
    private let ingestURL: URL
    private let claimURL: URL
    private let apiKey: String
    private let bundleId: String
    private let session: URLSession
    private let offlineQueue: OfflineQueue
    private let networkMonitor: NetworkMonitor
    private let compressionEnabled: Bool
    private var flushTask: Task<Void, Never>?
    private let encoder = JSONEncoder()

    private let batchSize = 20
    private let maxBufferSize = 10_000
    private let flushInterval: UInt64 = 5_000_000_000 // 5 seconds
    private let maxRetries = 5
    private let maxBackoff: TimeInterval = 30
    private let compressionThreshold = 512

    private static let logger = Logger(subsystem: Owl.logSubsystem, category: "transport")

    init(
        endpoint: URL,
        apiKey: String,
        bundleId: String,
        compressionEnabled: Bool,
        offlineQueue: OfflineQueue,
        networkMonitor: NetworkMonitor,
        session: URLSession = .shared
    ) {
        self.ingestURL = endpoint.appendingPathComponent("v1/ingest")
        self.claimURL = endpoint.appendingPathComponent("v1/identity/claim")
        self.apiKey = apiKey
        self.bundleId = bundleId
        self.compressionEnabled = compressionEnabled
        self.offlineQueue = offlineQueue
        self.networkMonitor = networkMonitor
        self.session = session
    }

    func start() {
        guard flushTask == nil else { return }
        flushTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: self?.flushInterval ?? 5_000_000_000)
                guard let self else { break }
                await self.flush()
            }
        }
    }

    func shutdown() async {
        flushTask?.cancel()
        flushTask = nil
        await flushAll()
    }

    deinit {
        flushTask?.cancel()
    }

    func enqueue(_ event: LogEvent) {
        buffer.append(event)
        if buffer.count > maxBufferSize {
            buffer.removeFirst(buffer.count - maxBufferSize)
        }
        if buffer.count >= batchSize {
            Task { await flush() }
        }
    }

    func flush() async {
        let offlineEvents = await offlineQueue.drain()
        if !offlineEvents.isEmpty {
            buffer.insert(contentsOf: offlineEvents, at: 0)
        }

        guard !buffer.isEmpty else { return }

        let batch = Array(buffer.prefix(batchSize))
        buffer.removeFirst(min(batchSize, buffer.count))

        guard networkMonitor.isConnected else {
            await offlineQueue.enqueue(batch)
            return
        }

        let success = await send(batch)
        if !success {
            await offlineQueue.enqueue(batch)
        }
    }

    func flushAll() async {
        let offlineEvents = await offlineQueue.drain()
        if !offlineEvents.isEmpty {
            buffer.insert(contentsOf: offlineEvents, at: 0)
        }

        while !buffer.isEmpty {
            let batch = Array(buffer.prefix(batchSize))
            buffer.removeFirst(min(batchSize, buffer.count))

            guard networkMonitor.isConnected else {
                await offlineQueue.enqueue(batch + buffer)
                buffer.removeAll()
                return
            }

            let success = await send(batch)
            if !success {
                await offlineQueue.enqueue(batch)
            }
        }
    }

    func persistBufferToDisk() async {
        guard !buffer.isEmpty else { return }
        await offlineQueue.enqueue(buffer)
        buffer.removeAll()
        await offlineQueue.persistNow()
    }

    func claimIdentity(anonymousId: String, userId: String) async {
        // Flush any buffered events first so the server has them before we claim
        await flushAll()

        let body: [String: String] = [
            "anonymous_id": anonymousId,
            "user_id": userId,
        ]

        guard let httpBody = try? encoder.encode(body) else {
            Self.logger.error("Failed to encode claim request")
            return
        }

        let request = makeRequest(url: claimURL, body: httpBody)
        let result = await performWithRetry(request, label: "Claim")

        if result {
            Self.logger.info("Identity claimed: \(anonymousId) → \(userId)")
        } else {
            Self.logger.error("Identity claim failed after \(self.maxRetries) attempts")
        }
    }

    private func send(_ events: [LogEvent]) async -> Bool {
        guard let httpBody = try? encoder.encode(IngestRequestBody(bundle_id: bundleId, events: events)) else {
            Self.logger.error("Failed to encode events")
            return false
        }

        let request = makeRequest(url: ingestURL, body: httpBody)
        return await performWithRetry(request, label: "Ingest")
    }

    // MARK: - Private Helpers

    private func makeRequest(url: URL, body: Data) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        if compressionEnabled, body.count >= compressionThreshold,
           let compressed = try? body.gzipped() {
            request.httpBody = compressed
            request.setValue("gzip", forHTTPHeaderField: "Content-Encoding")
        } else {
            request.httpBody = body
        }

        return request
    }

    private func performWithRetry(_ request: URLRequest, label: String) async -> Bool {
        for attempt in 0..<maxRetries {
            do {
                let (data, response) = try await session.data(for: request)

                if let http = response as? HTTPURLResponse {
                    if (200..<300).contains(http.statusCode) {
                        if let ingestResponse = try? JSONDecoder().decode(IngestResponse.self, from: data),
                           ingestResponse.rejected > 0 {
                            Self.logger.warning("Server rejected \(ingestResponse.rejected) events")
                        }
                        return true
                    }

                    // Don't retry client errors — they won't succeed
                    if (400..<500).contains(http.statusCode) {
                        Self.logger.warning("\(label) returned \(http.statusCode), not retrying")
                        return false
                    }

                    Self.logger.warning("\(label) returned \(http.statusCode), attempt \(attempt + 1)/\(self.maxRetries)")
                }
            } catch {
                Self.logger.warning("\(label) failed: \(error.localizedDescription), attempt \(attempt + 1)/\(self.maxRetries)")
            }

            if attempt < maxRetries - 1 {
                let backoff = min(pow(2.0, Double(attempt)), maxBackoff)
                try? await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))
            }
        }

        return false
    }
}

private struct IngestResponse: Codable {
    let accepted: Int
    let rejected: Int
}
