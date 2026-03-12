import Foundation

actor OfflineQueue {
    private var events: [LogEvent] = []
    private let fileURL: URL
    private let maxEvents = 1000
    private var pendingWrite = false

    init(directory: URL? = nil) {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("OwlMetry", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("offline_queue.json")
        self.events = Self.loadFromDisk(url: self.fileURL)
    }

    func enqueue(_ event: LogEvent) {
        events.append(event)
        trimAndPersist()
    }

    func enqueue(_ batch: [LogEvent]) {
        events.append(contentsOf: batch)
        trimAndPersist()
    }

    func drain() -> [LogEvent] {
        let drained = events
        events.removeAll()
        writeToDisk()
        return drained
    }

    var count: Int { events.count }
    var isEmpty: Bool { events.isEmpty }

    private func trimAndPersist() {
        if events.count > maxEvents {
            events.removeFirst(events.count - maxEvents)
        }
        scheduleDiskWrite()
    }

    private func scheduleDiskWrite() {
        guard !pendingWrite else { return }
        pendingWrite = true
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1s debounce
            self.writeToDisk()
            self.pendingWrite = false
        }
    }

    private func writeToDisk() {
        do {
            let data = try JSONEncoder().encode(events)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            // Best-effort persistence; avoid recursive logging
        }
    }

    private static func loadFromDisk(url: URL) -> [LogEvent] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([LogEvent].self, from: data)) ?? []
    }
}
