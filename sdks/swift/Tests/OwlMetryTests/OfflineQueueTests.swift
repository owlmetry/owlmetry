import XCTest
@testable import OwlMetry

final class OfflineQueueTests: XCTestCase {
    private var tempDir: URL!

    override func setUp() {
        tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tempDir)
    }

    func testEnqueueAndDrain() async {
        let queue = OfflineQueue(directory: tempDir)
        let event = makeEvent(body: "test")

        await queue.enqueue(event)
        let drained = await queue.drain()

        XCTAssertEqual(drained.count, 1)
        XCTAssertEqual(drained.first?.body, "test")
    }

    func testDrainClearsQueue() async {
        let queue = OfflineQueue(directory: tempDir)
        await queue.enqueue(makeEvent(body: "a"))

        _ = await queue.drain()
        let second = await queue.drain()

        XCTAssertTrue(second.isEmpty)
    }

    func testBatchEnqueue() async {
        let queue = OfflineQueue(directory: tempDir)
        let events = (0..<5).map { makeEvent(body: "event_\($0)") }

        await queue.enqueue(events)
        let count = await queue.count

        XCTAssertEqual(count, 5)
    }

    func testPersistsToDisk() async {
        // Enqueue with one instance
        let queue1 = OfflineQueue(directory: tempDir)
        await queue1.enqueue(makeEvent(body: "persisted"))

        // Force write by draining and re-enqueuing
        _ = await queue1.drain()
        await queue1.enqueue(makeEvent(body: "persisted"))

        // Wait for debounced disk write
        try? await Task.sleep(nanoseconds: 2_000_000_000)

        // Read with new instance
        let queue2 = OfflineQueue(directory: tempDir)
        let count = await queue2.count

        XCTAssertEqual(count, 1)
    }

    // MARK: - Helpers

    private func makeEvent(body: String) -> LogEvent {
        LogEvent(
            clientEventId: UUID().uuidString,
            userIdentifier: nil,
            level: .info,
            source: nil,
            body: body,
            context: nil,
            meta: nil,
            platform: .ios,
            osVersion: "17.0",
            appVersion: "1.0",
            buildNumber: "1",
            deviceModel: "iPhone16,1",
            locale: "en_US",
            timestamp: "2026-01-01T00:00:00.000Z"
        )
    }
}
