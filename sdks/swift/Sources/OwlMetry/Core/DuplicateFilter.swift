import Foundation

actor DuplicateFilter {
    private var recentLogs: [String: (count: Int, timestamp: Date)] = [:]
    private let cacheTimeout: TimeInterval = 60
    private let maxDuplicatesPerWindow = 10
    private var cleanupTask: Task<Void, Never>?

    func start() {
        guard cleanupTask == nil else { return }
        cleanupTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                guard let self else { break }
                await self.cleanup()
            }
        }
    }

    deinit {
        cleanupTask?.cancel()
    }

    func shouldAllow(_ event: LogEvent) -> Bool {
        let key = compositeKey(for: event)
        let now = Date()

        if let existing = recentLogs[key] {
            if now.timeIntervalSince(existing.timestamp) > cacheTimeout {
                recentLogs.removeValue(forKey: key)
            } else if existing.count >= maxDuplicatesPerWindow {
                return false
            }
        }

        recentLogs[key] = (
            count: (recentLogs[key]?.count ?? 0) + 1,
            timestamp: recentLogs[key]?.timestamp ?? now
        )

        return true
    }

    private func cleanup() {
        let now = Date()
        recentLogs = recentLogs.filter { now.timeIntervalSince($0.value.timestamp) < cacheTimeout }
    }

    private func compositeKey(for event: LogEvent) -> String {
        var relevantAttributes = ""
        if let attributes = event.customAttributes {
            let relevantKeys = attributes.keys
                .filter { !EventBuilder.systemMetaKeys.contains($0) }
                .sorted()
            if !relevantKeys.isEmpty {
                relevantAttributes = relevantKeys.map { "\($0):\(attributes[$0] ?? "")" }.joined(separator: "|")
            }
        }
        return "\(event.level.rawValue)|\(event.message)|\(event.screenName ?? "")|\(relevantAttributes)"
    }
}
