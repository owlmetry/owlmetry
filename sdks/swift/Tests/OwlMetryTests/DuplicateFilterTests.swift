import XCTest
@testable import OwlMetry

final class DuplicateFilterTests: XCTestCase {
    private var filter: DuplicateFilter!

    override func setUp() {
        filter = DuplicateFilter()
    }

    func testAllowsFirstOccurrence() async {
        let event = LogEvent.stub(message: "hello")
        let allowed = await filter.shouldAllow(event)
        XCTAssertTrue(allowed)
    }

    func testAllowsUpToMaxDuplicates() async {
        let event = LogEvent.stub(message: "repeated")
        for i in 1...10 {
            let allowed = await filter.shouldAllow(event)
            XCTAssertTrue(allowed, "Event \(i) should be allowed")
        }
    }

    func testBlocksAfterMaxDuplicates() async {
        let event = LogEvent.stub(message: "spam")
        for _ in 1...10 {
            _ = await filter.shouldAllow(event)
        }
        let blocked = await filter.shouldAllow(event)
        XCTAssertFalse(blocked, "11th duplicate should be blocked")
    }

    func testDifferentEventsAreIndependent() async {
        let eventA = LogEvent.stub(message: "message A")
        let eventB = LogEvent.stub(message: "message B")

        for _ in 1...10 {
            _ = await filter.shouldAllow(eventA)
        }

        let allowedB = await filter.shouldAllow(eventB)
        XCTAssertTrue(allowedB, "Different event should not be affected")

        let blockedA = await filter.shouldAllow(eventA)
        XCTAssertFalse(blockedA, "Original event should still be blocked")
    }

    func testDifferentContextCreatesDistinctKey() async {
        let eventA = LogEvent.stub(message: "same", screenName: "screen_a")
        let eventB = LogEvent.stub(message: "same", screenName: "screen_b")

        for _ in 1...10 {
            _ = await filter.shouldAllow(eventA)
        }

        let allowed = await filter.shouldAllow(eventB)
        XCTAssertTrue(allowed)
    }

    func testSystemMetaKeysExcludedFromKey() async {
        let event1 = LogEvent.stub(message: "test", customAttributes: ["_file": "A.swift", "_line": "1", "_function": "foo", "key": "val"])
        let event2 = LogEvent.stub(message: "test", customAttributes: ["_file": "B.swift", "_line": "99", "_function": "bar", "key": "val"])

        _ = await filter.shouldAllow(event1)
        let allowed = await filter.shouldAllow(event2)
        XCTAssertTrue(allowed)
    }
}
