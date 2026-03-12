import Foundation
@testable import OwlMetry

extension LogEvent {
    static func stub(
        body: String,
        level: LogLevel = .info,
        context: String? = nil,
        meta: [String: String]? = nil,
        userIdentifier: String? = nil
    ) -> LogEvent {
        LogEvent(
            clientEventId: UUID().uuidString,
            userIdentifier: userIdentifier,
            level: level,
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
