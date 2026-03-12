import XCTest
@testable import OwlMetry

final class LogEventTests: XCTestCase {
    func testCodableRoundTrip() throws {
        let event = LogEvent(
            clientEventId: "abc-123",
            userIdentifier: "user1",
            level: .error,
            source: "File.swift:test:1",
            body: "something broke",
            context: "checkout",
            meta: ["key": "val"],
            platform: .ios,
            osVersion: "17.0",
            appVersion: "2.0",
            buildNumber: "100",
            deviceModel: "iPhone16,1",
            locale: "en_US",
            timestamp: "2026-01-01T00:00:00.000Z"
        )

        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(LogEvent.self, from: data)

        XCTAssertEqual(decoded.clientEventId, event.clientEventId)
        XCTAssertEqual(decoded.userIdentifier, event.userIdentifier)
        XCTAssertEqual(decoded.level, event.level)
        XCTAssertEqual(decoded.body, event.body)
        XCTAssertEqual(decoded.context, event.context)
        XCTAssertEqual(decoded.platform, event.platform)
    }

    func testJSONKeysAreSnakeCase() throws {
        let event = LogEvent(
            clientEventId: "id",
            userIdentifier: nil,
            level: .info,
            source: nil,
            body: "test",
            context: nil,
            meta: nil,
            platform: .macos,
            osVersion: nil,
            appVersion: nil,
            buildNumber: nil,
            deviceModel: nil,
            locale: nil,
            timestamp: "2026-01-01T00:00:00.000Z"
        )

        let data = try JSONEncoder().encode(event)
        let json = String(data: data, encoding: .utf8)!

        XCTAssertTrue(json.contains("client_event_id"))
        XCTAssertFalse(json.contains("clientEventId"))
    }

    func testNilFieldsOmittedInJSON() throws {
        let event = LogEvent(
            clientEventId: "id",
            userIdentifier: nil,
            level: .info,
            source: nil,
            body: "test",
            context: nil,
            meta: nil,
            platform: .ios,
            osVersion: nil,
            appVersion: nil,
            buildNumber: nil,
            deviceModel: nil,
            locale: nil,
            timestamp: "2026-01-01T00:00:00.000Z"
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(event)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertNil(json["user_identifier"])
        XCTAssertNil(json["source"])
        XCTAssertNil(json["context"])
        XCTAssertNil(json["meta"])
        XCTAssertNil(json["os_version"])
    }
}
