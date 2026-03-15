import XCTest
@testable import OwlMetry

final class LogEventTests: XCTestCase {
    func testCodableRoundTrip() throws {
        let event = LogEvent(
            clientEventId: "abc-123",
            sessionId: "session-123",
            userId: "user1",
            level: .error,
            sourceModule: "File.swift:test:1",
            message: "something broke",
            screenName: "checkout",
            customAttributes: ["key": "val"],
            environment: .ios,
            osVersion: "17.0",
            appVersion: "2.0",
            buildNumber: "100",
            deviceModel: "iPhone16,1",
            locale: "en_US",
            isDebug: true,
            timestamp: "2026-01-01T00:00:00.000Z"
        )

        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(LogEvent.self, from: data)

        XCTAssertEqual(decoded.clientEventId, event.clientEventId)
        XCTAssertEqual(decoded.userId, event.userId)
        XCTAssertEqual(decoded.level, event.level)
        XCTAssertEqual(decoded.message, event.message)
        XCTAssertEqual(decoded.screenName, event.screenName)
        XCTAssertEqual(decoded.environment, event.environment)
    }

    func testJSONKeysAreSnakeCase() throws {
        let event = LogEvent(
            clientEventId: "id",
            sessionId: "session-id",
            userId: nil,
            level: .info,
            sourceModule: nil,
            message: "test",
            screenName: nil,
            customAttributes: nil,
            environment: .macos,
            osVersion: nil,
            appVersion: nil,
            buildNumber: nil,
            deviceModel: nil,
            locale: nil,
            isDebug: false,
            timestamp: "2026-01-01T00:00:00.000Z"
        )

        let data = try JSONEncoder().encode(event)
        let json = String(data: data, encoding: .utf8)!

        XCTAssertTrue(json.contains("client_event_id"))
        XCTAssertTrue(json.contains("session_id"))
        XCTAssertFalse(json.contains("clientEventId"))
    }

    func testNilFieldsOmittedInJSON() throws {
        let event = LogEvent(
            clientEventId: "id",
            sessionId: "session-id",
            userId: nil,
            level: .info,
            sourceModule: nil,
            message: "test",
            screenName: nil,
            customAttributes: nil,
            environment: .ios,
            osVersion: nil,
            appVersion: nil,
            buildNumber: nil,
            deviceModel: nil,
            locale: nil,
            isDebug: false,
            timestamp: "2026-01-01T00:00:00.000Z"
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(event)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertNil(json["user_id"])
        XCTAssertNil(json["source_module"])
        XCTAssertNil(json["screen_name"])
        XCTAssertNil(json["custom_attributes"])
        XCTAssertNil(json["os_version"])
    }
}
