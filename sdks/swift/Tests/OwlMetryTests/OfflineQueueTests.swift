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
        await queue.enqueue(LogEvent.stub(message: "test"))
        let drained = await queue.drain()

        XCTAssertEqual(drained.count, 1)
        XCTAssertEqual(drained.first?.message, "test")
    }

    func testDrainClearsQueue() async {
        let queue = OfflineQueue(directory: tempDir)
        await queue.enqueue(LogEvent.stub(message: "a"))

        _ = await queue.drain()
        let second = await queue.drain()

        XCTAssertTrue(second.isEmpty)
    }

    func testBatchEnqueue() async {
        let queue = OfflineQueue(directory: tempDir)
        let events = (0..<5).map { LogEvent.stub(message: "event_\($0)") }

        await queue.enqueue(events)
        let count = await queue.count

        XCTAssertEqual(count, 5)
    }

    func testPersistsToDisk() async {
        let queue1 = OfflineQueue(directory: tempDir)
        await queue1.enqueue(LogEvent.stub(message: "persisted"))

        _ = await queue1.drain()
        await queue1.enqueue(LogEvent.stub(message: "persisted"))

        // Wait for debounced disk write
        try? await Task.sleep(nanoseconds: 2_000_000_000)

        let queue2 = OfflineQueue(directory: tempDir)
        let count = await queue2.count

        XCTAssertEqual(count, 1)
    }
}
