import XCTest
@testable import OwlMetry

final class EventBuilderTests: XCTestCase {
    private let deviceInfo = DeviceInfo(
        platform: .ios,
        osVersion: "17.0.0",
        appVersion: "1.0",
        buildNumber: "42",
        deviceModel: "iPhone16,1",
        locale: "en_US"
    )

    func testBuildsEventWithAllFields() {
        let event = EventBuilder.build(
            body: "hello",
            level: .info,
            context: "onboarding",
            meta: ["key": "value"],
            userIdentifier: "user123",
            deviceInfo: deviceInfo,
            file: "/path/to/MyFile.swift",
            function: "doStuff()",
            line: 42
        )

        XCTAssertEqual(event.body, "hello")
        XCTAssertEqual(event.level, .info)
        XCTAssertEqual(event.context, "onboarding")
        XCTAssertEqual(event.userIdentifier, "user123")
        XCTAssertEqual(event.platform, .ios)
        XCTAssertEqual(event.osVersion, "17.0.0")
        XCTAssertEqual(event.appVersion, "1.0")
        XCTAssertEqual(event.buildNumber, "42")
        XCTAssertEqual(event.deviceModel, "iPhone16,1")
        XCTAssertEqual(event.locale, "en_US")
    }

    func testSourceFormattedFromFileFunctionLine() {
        let event = EventBuilder.build(
            body: "test",
            level: .debug,
            context: nil,
            meta: nil,
            userIdentifier: nil,
            deviceInfo: deviceInfo,
            file: "/Users/dev/project/Sources/ViewModel.swift",
            function: "loadData()",
            line: 99
        )

        XCTAssertEqual(event.source, "ViewModel.swift:loadData():99")
    }

    func testSystemMetaKeysAdded() {
        let event = EventBuilder.build(
            body: "test",
            level: .info,
            context: nil,
            meta: nil,
            userIdentifier: nil,
            deviceInfo: deviceInfo,
            file: "/path/File.swift",
            function: "func()",
            line: 1
        )

        XCTAssertEqual(event.meta?["_file"], "File.swift")
        XCTAssertEqual(event.meta?["_function"], "func()")
        XCTAssertEqual(event.meta?["_line"], "1")
    }

    func testUserMetaMergedWithSystemMeta() {
        let event = EventBuilder.build(
            body: "test",
            level: .info,
            context: nil,
            meta: ["custom": "data"],
            userIdentifier: nil,
            deviceInfo: deviceInfo,
            file: "/path/File.swift",
            function: "f()",
            line: 1
        )

        XCTAssertEqual(event.meta?["custom"], "data")
        XCTAssertNotNil(event.meta?["_file"])
    }

    func testClientEventIdIsValidUUID() {
        let event = EventBuilder.build(
            body: "test",
            level: .info,
            context: nil,
            meta: nil,
            userIdentifier: nil,
            deviceInfo: deviceInfo,
            file: "F.swift",
            function: "f()",
            line: 1
        )

        XCTAssertNotNil(UUID(uuidString: event.clientEventId))
    }

    func testTimestampIsISO8601() {
        let event = EventBuilder.build(
            body: "test",
            level: .info,
            context: nil,
            meta: nil,
            userIdentifier: nil,
            deviceInfo: deviceInfo,
            file: "F.swift",
            function: "f()",
            line: 1
        )

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        XCTAssertNotNil(formatter.date(from: event.timestamp))
    }

    func testMetaValuesTrimmed() {
        let longValue = String(repeating: "x", count: 300)
        let event = EventBuilder.build(
            body: "test",
            level: .info,
            context: nil,
            meta: ["big": longValue],
            userIdentifier: nil,
            deviceInfo: deviceInfo,
            file: "F.swift",
            function: "f()",
            line: 1
        )

        XCTAssertTrue(event.meta?["big"]?.contains("[TRIMMED") == true)
    }
}
