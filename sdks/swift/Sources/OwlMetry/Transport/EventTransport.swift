import Foundation
import os

actor EventTransport {
    private var buffer: [LogEvent] = []
    private let endpoint: URL
    private let apiKey: String
    private let session: URLSession
    private let offlineQueue: OfflineQueue
    private let networkMonitor: NetworkMonitor
    private var flushTask: Task<Void, Never>?

    private let batchSize = 20
    private let flushInterval: UInt64 = 5_000_000_000 // 5 seconds
    private let maxRetries = 5
    private let maxBackoff: TimeInterval = 30

    private static let logger = Logger(subsystem: "com.owlmetry.sdk", category: "transport")

    init(
        endpoint: URL,
        apiKey: String,
        offlineQueue: OfflineQueue,
        networkMonitor: NetworkMonitor,
        session: URLSession = .shared
    ) {
        self.endpoint = endpoint
        self.apiKey = apiKey
        self.offlineQueue = offlineQueue
        self.networkMonitor = networkMonitor
        self.session = session
    }

    func start() {
        startFlushTimer()
    }

    deinit {
        flushTask?.cancel()
    }

    func enqueue(_ event: LogEvent) {
        buffer.append(event)
        if buffer.count >= batchSize {
            Task { await flush() }
        }
    }

    func flush() async {
        // Drain offline queue first
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

    private func send(_ events: [LogEvent]) async -> Bool {
        let url = endpoint.appendingPathComponent("v1/ingest")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        do {
            request.httpBody = try JSONEncoder().encode(IngestRequestBody(events: events))
        } catch {
            Self.logger.error("Failed to encode events: \(error.localizedDescription)")
            return false
        }

        for attempt in 0..<maxRetries {
            do {
                let (data, response) = try await session.data(for: request)

                if let httpResponse = response as? HTTPURLResponse,
                   (200..<300).contains(httpResponse.statusCode) {
                    if let body = try? JSONDecoder().decode(IngestResponse.self, from: data),
                       body.rejected > 0 {
                        Self.logger.warning("Server rejected \(body.rejected) events")
                    }
                    return true
                }

                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                Self.logger.warning("Ingest returned \(statusCode), attempt \(attempt + 1)/\(self.maxRetries)")
            } catch {
                Self.logger.warning("Ingest failed: \(error.localizedDescription), attempt \(attempt + 1)/\(self.maxRetries)")
            }

            if attempt < maxRetries - 1 {
                let backoff = min(pow(2.0, Double(attempt)), maxBackoff)
                try? await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))
            }
        }

        return false
    }

    private func startFlushTimer() {
        flushTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: self?.flushInterval ?? 5_000_000_000)
                guard let self else { break }
                await self.flush()
            }
        }
    }
}

private struct IngestResponse: Codable {
    let accepted: Int
    let rejected: Int
}
