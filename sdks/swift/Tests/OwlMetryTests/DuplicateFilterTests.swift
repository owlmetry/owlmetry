import XCTest
@testable import OwlMetry

final class DuplicateFilterTests: XCTestCase {
    private var filter: DuplicateFilter!

    override func setUp() {
        filter = DuplicateFilter()
    }

    func testAllowsFirstOccurrence() async {
        let event = makeEvent(body: "hello")
        let allowed = await filter.shouldAllow(event)
        XCTAssertTrue(allowed)
    }

    func testAllowsUpToMaxDuplicates() async {
        let event = makeEvent(body: "repeated")
        for i in 1...10 {
            let allowed = await filter.shouldAllow(event)
            XCTAssertTrue(allowed, "Event \(i) should be allowed")
        }
    }

    func testBlocksAfterMaxDuplicates() async {
        let event = makeEvent(body: "spam")
        for _ in 1...10 {
            _ = await filter.shouldAllow(event)
        }
        let blocked = await filter.shouldAllow(event)
        XCTAssertFalse(blocked, "11th duplicate should be blocked")
    }

    func testDifferentEventsAreIndependent() async {
        let eventA = makeEvent(body: "message A")
        let eventB = makeEvent(body: "message B")

        for _ in 1...10 {
            _ = await filter.shouldAllow(eventA)
        }

        let allowedB = await filter.shouldAllow(eventB)
        XCTAssertTrue(allowedB, "Different event should not be affected")

        let blockedA = await filter.shouldAllow(eventA)
        XCTAssertFalse(blockedA, "Original event should still be blocked")
    }

    func testDifferentContextCreatesDistinctKey() async {
        let eventA = makeEvent(body: "same", context: "screen_a")
        let eventB = makeEvent(body: "same", context: "screen_b")

        for _ in 1...10 {
            _ = await filter.shouldAllow(eventA)
        }

        let allowed = await filter.shouldAllow(eventB)
        XCTAssertTrue(allowed)
    }

    func testSystemMetaKeysExcludedFromKey() async {
        let event1 = makeEvent(body: "test", meta: ["_file": "A.swift", "_line": "1", "_function": "foo", "key": "val"])
        let event2 = makeEvent(body: "test", meta: ["_file": "B.swift", "_line": "99", "_function": "bar", "key": "val"])

        _ = await filter.shouldAllow(event1)
        // event2 differs only in system meta, so should share the same dedup key
        // It's the 2nd occurrence, so should still be allowed
        let allowed = await filter.shouldAllow(event2)
        XCTAssertTrue(allowed)
    }

    // MARK: - Helpers

    private func makeEvent(
        body: String,
        context: String? = nil,
        meta: [String: String]? = nil
    ) -> LogEvent {
        LogEvent(
            clientEventId: UUID().uuidString,
            userIdentifier: nil,
            level: .info,
            source: "Test.swift:test:1",
            body: body,
            context: context,
            meta: meta,
            platform: .ios,
            osVersion: "17.0.0",
            appVersion: "1.0",
            buildNumber: "1",
            deviceModel: "iPhone16,1",
            locale: "en_US",
            timestamp: "2026-01-01T00:00:00.000Z"
        )
    }
}
