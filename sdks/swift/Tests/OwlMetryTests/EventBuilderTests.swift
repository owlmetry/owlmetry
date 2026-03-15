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
            message: "hello",
            level: .info,
            screenName: "onboarding",
            customAttributes: ["key": "value"],
            userId: "user123",
            sessionId: "test-session-id",
            deviceInfo: deviceInfo,
            isDebug: true,
            file: "/path/to/MyFile.swift",
            function: "doStuff()",
            line: 42
        )

        XCTAssertEqual(event.message, "hello")
        XCTAssertEqual(event.level, .info)
        XCTAssertEqual(event.screenName, "onboarding")
        XCTAssertEqual(event.userId, "user123")
        XCTAssertEqual(event.environment, .ios)
        XCTAssertEqual(event.osVersion, "17.0.0")
        XCTAssertEqual(event.appVersion, "1.0")
        XCTAssertEqual(event.buildNumber, "42")
        XCTAssertEqual(event.deviceModel, "iPhone16,1")
        XCTAssertEqual(event.locale, "en_US")
    }

    func testSourceModuleFormattedFromFileFunctionLine() {
        let event = EventBuilder.build(
            message: "test",
            level: .debug,
            screenName: nil,
            customAttributes: nil,
            userId: nil,
            sessionId: "test-session-id",
            deviceInfo: deviceInfo,
            isDebug: true,
            file: "/Users/dev/project/Sources/ViewModel.swift",
            function: "loadData()",
            line: 99
        )

        XCTAssertEqual(event.sourceModule, "ViewModel.swift:loadData():99")
    }

    func testSystemMetaKeysAdded() {
        let event = EventBuilder.build(
            message: "test",
            level: .info,
            screenName: nil,
            customAttributes: nil,
            userId: nil,
            sessionId: "test-session-id",
            deviceInfo: deviceInfo,
            isDebug: true,
            file: "/path/File.swift",
            function: "func()",
            line: 1
        )

        XCTAssertEqual(event.customAttributes?["_file"], "File.swift")
        XCTAssertEqual(event.customAttributes?["_function"], "func()")
        XCTAssertEqual(event.customAttributes?["_line"], "1")
    }

    func testUserCustomAttributesMergedWithSystemAttributes() {
        let event = EventBuilder.build(
            message: "test",
            level: .info,
            screenName: nil,
            customAttributes: ["custom": "data"],
            userId: nil,
            sessionId: "test-session-id",
            deviceInfo: deviceInfo,
            isDebug: true,
            file: "/path/File.swift",
            function: "f()",
            line: 1
        )

        XCTAssertEqual(event.customAttributes?["custom"], "data")
        XCTAssertNotNil(event.customAttributes?["_file"])
    }

    func testClientEventIdIsValidUUID() {
        let event = EventBuilder.build(
            message: "test",
            level: .info,
            screenName: nil,
            customAttributes: nil,
            userId: nil,
            sessionId: "test-session-id",
            deviceInfo: deviceInfo,
            isDebug: true,
            file: "F.swift",
            function: "f()",
            line: 1
        )

        XCTAssertNotNil(UUID(uuidString: event.clientEventId))
    }

    func testTimestampIsISO8601() {
        let event = EventBuilder.build(
            message: "test",
            level: .info,
            screenName: nil,
            customAttributes: nil,
            userId: nil,
            sessionId: "test-session-id",
            deviceInfo: deviceInfo,
            isDebug: true,
            file: "F.swift",
            function: "f()",
            line: 1
        )

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        XCTAssertNotNil(formatter.date(from: event.timestamp))
    }

    func testCustomAttributeValuesTrimmed() {
        let longValue = String(repeating: "x", count: 300)
        let event = EventBuilder.build(
            message: "test",
            level: .info,
            screenName: nil,
            customAttributes: ["big": longValue],
            userId: nil,
            sessionId: "test-session-id",
            deviceInfo: deviceInfo,
            isDebug: true,
            file: "F.swift",
            function: "f()",
            line: 1
        )

        XCTAssertTrue(event.customAttributes?["big"]?.contains("[TRIMMED") == true)
    }
}
