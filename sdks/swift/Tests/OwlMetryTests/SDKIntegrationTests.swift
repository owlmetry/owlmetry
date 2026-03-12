import XCTest
@testable import OwlMetry

/// End-to-end tests that run against a real OwlMetry server with a real database.
/// These require the server to be running at TEST_ENDPOINT with the test database seeded.
/// Run via: `pnpm test:swift-sdk` (which handles server lifecycle automatically).
final class SDKIntegrationTests: XCTestCase {
    /// Must match the test keys in apps/server/src/__tests__/setup.ts
    static let testEndpoint = ProcessInfo.processInfo.environment["OWLMETRY_TEST_ENDPOINT"]
        ?? "http://localhost:4111"
    static let testClientKey = "owl_client_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    static let testAgentKey = "owl_agent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

    override func setUp() async throws {
        // Reset SDK state (simulates app restart)
        await Owl.reset()

        // Clear persisted identity state between tests
        Owl.clearUser(newAnonymousId: true)
        IdentityManager.clearUserId()

        // Clear offline queue file from previous tests
        let tempQueue = OfflineQueue()
        await tempQueue.clear()

        let ready = await waitForServer(timeout: 10)
        guard ready else {
            throw XCTSkip("Server not running at \(Self.testEndpoint) — run via pnpm test:swift-sdk")
        }
    }

    override func tearDown() async throws {
        await Owl.shutdown()
    }

    // MARK: - Basic Tests

    func testFullRoundTrip() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        Owl.info("SDK integration test - info", context: "roundtrip")
        Owl.error("SDK integration test - error", context: "roundtrip", meta: ["source": "xcode"])
        Owl.warn("SDK integration test - warn", context: "roundtrip")

        await Owl.shutdown()

        let events = try await queryEvents(context: "roundtrip")

        XCTAssertGreaterThanOrEqual(events.count, 3, "Expected at least 3 events from SDK")

        let bodies = events.map { $0["body"] as? String ?? "" }
        XCTAssertTrue(bodies.contains("SDK integration test - info"))
        XCTAssertTrue(bodies.contains("SDK integration test - error"))
        XCTAssertTrue(bodies.contains("SDK integration test - warn"))

        // All events should have a user_identifier (anonymous ID)
        for event in events {
            let uid = event["user_identifier"] as? String
            XCTAssertNotNil(uid, "Every event should have a user_identifier")
            XCTAssertTrue(uid?.hasPrefix(IdentityManager.anonymousIdPrefix) == true, "Pre-login events should have anonymous ID")
        }

        // Verify device info was auto-populated
        if let firstEvent = events.first {
            XCTAssertNotNil(firstEvent["platform"])
            XCTAssertNotNil(firstEvent["os_version"])
            XCTAssertNotNil(firstEvent["device_model"])
            XCTAssertNotNil(firstEvent["locale"])
        }
    }

    func testTrackingEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        Owl.track("onboarding.step_1", meta: ["slide": "intro"])
        Owl.track("onboarding.step_2", meta: ["slide": "tutorial"])

        await Owl.shutdown()

        let events = try await queryEvents(level: "tracking")

        let bodies = events.map { $0["body"] as? String ?? "" }
        XCTAssertTrue(bodies.contains("onboarding.step_1"))
        XCTAssertTrue(bodies.contains("onboarding.step_2"))
    }

    func testMetadataPreserved() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        Owl.info("meta test", context: "checkout", meta: ["item_count": "3", "currency": "USD"])

        await Owl.shutdown()

        let events = try await queryEvents(context: "checkout")

        guard let event = events.first(where: { ($0["body"] as? String) == "meta test" }) else {
            XCTFail("Event not found")
            return
        }

        let meta = event["meta"] as? [String: String] ?? [:]
        XCTAssertEqual(meta["item_count"], "3")
        XCTAssertEqual(meta["currency"], "USD")
    }

    func testClientEventIdDedup() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        Owl.info("dedup test event", context: "dedup")
        Owl.info("dedup test event", context: "dedup")

        await Owl.shutdown()

        let events = try await queryEvents(context: "dedup")
        XCTAssertGreaterThanOrEqual(events.count, 2)
    }

    // MARK: - Identity Tests

    func testAnonymousIdAutoAssigned() async throws {
        // Events should always have a user_identifier even without calling setUser
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        Owl.info("anon id test", context: "anon_auto")

        await Owl.shutdown()

        let events = try await queryEvents(context: "anon_auto")
        XCTAssertGreaterThanOrEqual(events.count, 1)

        let uid = events.first?["user_identifier"] as? String
        XCTAssertNotNil(uid)
        XCTAssertTrue(uid?.hasPrefix(IdentityManager.anonymousIdPrefix) == true,
                       "Event should have auto-generated anonymous ID")
    }

    func testAnonymousIdConsistentAcrossEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        Owl.info("consistent anon 1", context: "anon_consistent")
        Owl.info("consistent anon 2", context: "anon_consistent")
        Owl.info("consistent anon 3", context: "anon_consistent")

        await Owl.shutdown()

        let events = try await queryEvents(context: "anon_consistent")
        XCTAssertGreaterThanOrEqual(events.count, 3)

        let userIds = Set(events.compactMap { $0["user_identifier"] as? String })
        XCTAssertEqual(userIds.count, 1,
                       "All events in one session should have the same anonymous ID")
    }

    func testSetUserChangesIdentifier() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        // Send event with anonymous ID
        Owl.info("before login", context: "set_user")
        await Owl.shutdown()

        // Set real user and send another event
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)
        Owl.setUser("real-user-123")

        // Small delay to let claim request fire
        try await Task.sleep(nanoseconds: 1_000_000_000)

        Owl.info("after login", context: "set_user")
        await Owl.shutdown()

        let events = try await queryEvents(context: "set_user")
        XCTAssertGreaterThanOrEqual(events.count, 2)

        // The "after login" event should have the real user ID
        let afterLogin = events.first(where: { ($0["body"] as? String) == "after login" })
        XCTAssertEqual(afterLogin?["user_identifier"] as? String, "real-user-123")
    }

    func testIdentityClaimUpdatesAnonymousEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        // Send events before login
        Owl.info("pre-login event 1", context: "claim_test")
        Owl.info("pre-login event 2", context: "claim_test")
        Owl.warn("pre-login event 3", context: "claim_test")

        await Owl.shutdown()

        // Verify events have anonymous ID
        let preClaimEvents = try await queryEvents(context: "claim_test")
        XCTAssertGreaterThanOrEqual(preClaimEvents.count, 3)

        let anonId = preClaimEvents.first?["user_identifier"] as? String
        XCTAssertNotNil(anonId)
        XCTAssertTrue(anonId?.hasPrefix(IdentityManager.anonymousIdPrefix) == true)

        // Now "login" — this triggers the claim
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)
        Owl.setUser("claimed-user-456")

        // Wait for the claim to process
        try await Task.sleep(nanoseconds: 2_000_000_000)

        await Owl.shutdown()

        // Query events again — they should all now have the real user ID
        let postClaimEvents = try await queryEvents(context: "claim_test")
        XCTAssertGreaterThanOrEqual(postClaimEvents.count, 3)

        for event in postClaimEvents {
            let uid = event["user_identifier"] as? String
            XCTAssertEqual(uid, "claimed-user-456",
                           "Event '\(event["body"] as? String ?? "")' should have claimed user ID")
        }
    }

    func testClaimEndpointDirectly() async throws {
        // First ingest some events with an anonymous ID
        let anonId = "\(IdentityManager.anonymousIdPrefix)\(UUID().uuidString)"

        let ingestPayload: [[String: Any]] = [
            ["level": "info", "body": "direct claim test 1", "user_identifier": anonId, "context": "direct_claim"],
            ["level": "info", "body": "direct claim test 2", "user_identifier": anonId, "context": "direct_claim"],
        ]

        try await ingestEvents(ingestPayload)

        // Verify events exist with anonymous ID
        let preClaim = try await queryEvents(context: "direct_claim")
        XCTAssertEqual(preClaim.count, 2)
        XCTAssertEqual(preClaim.first?["user_identifier"] as? String, anonId)

        // Call claim endpoint
        let claimResponse = try await claimIdentity(anonymousId: anonId, userId: "direct-claimed-user")

        XCTAssertTrue(claimResponse["claimed"] as? Bool == true)
        XCTAssertEqual(claimResponse["events_updated"] as? Int, 2)

        // Verify events are updated
        let postClaim = try await queryEvents(context: "direct_claim")
        for event in postClaim {
            XCTAssertEqual(event["user_identifier"] as? String, "direct-claimed-user")
        }
    }

    func testClaimIsIdempotent() async throws {
        let anonId = "\(IdentityManager.anonymousIdPrefix)\(UUID().uuidString)"

        try await ingestEvents([
            ["level": "info", "body": "idempotent test", "user_identifier": anonId, "context": "idempotent_claim"],
        ])

        // Claim once
        let first = try await claimIdentity(anonymousId: anonId, userId: "idempotent-user")
        XCTAssertTrue(first["claimed"] as? Bool == true)
        XCTAssertEqual(first["events_updated"] as? Int, 1)

        // Claim again — should succeed without error
        let second = try await claimIdentity(anonymousId: anonId, userId: "idempotent-user")
        XCTAssertTrue(second["claimed"] as? Bool == true)
    }

    func testClaimRejectsInvalidAnonymousId() async throws {
        // Try to claim with a non-anonymous ID prefix
        let response = try await claimIdentityRaw(anonymousId: "not-anon-123", userId: "some-user")
        XCTAssertEqual(response.statusCode, 400)
    }

    func testClaimRejectsAnonymousUserId() async throws {
        let anonId = "\(IdentityManager.anonymousIdPrefix)\(UUID().uuidString)"
        try await ingestEvents([
            ["level": "info", "body": "test", "user_identifier": anonId, "context": "reject_anon_user"],
        ])

        // Try to claim with another anonymous ID as the user_id
        let response = try await claimIdentityRaw(
            anonymousId: anonId,
            userId: "\(IdentityManager.anonymousIdPrefix)should-not-work"
        )
        XCTAssertEqual(response.statusCode, 400)
    }

    func testClaimRejectsNonexistentAnonymousId() async throws {
        // Try to claim an anonymous ID with no events
        let fakeAnonId = "\(IdentityManager.anonymousIdPrefix)\(UUID().uuidString)"
        let response = try await claimIdentityRaw(anonymousId: fakeAnonId, userId: "some-user")
        XCTAssertEqual(response.statusCode, 404)
    }

    func testClearUserRevertsToAnonymousId() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        // Set user then clear
        Owl.setUser("temp-user")
        try await Task.sleep(nanoseconds: 500_000_000)
        Owl.clearUser()

        Owl.info("after clear", context: "clear_user")
        await Owl.shutdown()

        let events = try await queryEvents(context: "clear_user")
        XCTAssertGreaterThanOrEqual(events.count, 1)

        let uid = events.first?["user_identifier"] as? String
        XCTAssertNotNil(uid)
        XCTAssertTrue(uid?.hasPrefix(IdentityManager.anonymousIdPrefix) == true,
                       "After clearUser, events should use anonymous ID again")
    }

    func testClearUserWithNewAnonymousId() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        // Send an event to capture the original anonymous ID
        Owl.info("before clear new", context: "clear_new_anon")
        await Owl.shutdown()

        let beforeEvents = try await queryEvents(context: "clear_new_anon")
        let originalAnonId = beforeEvents.first?["user_identifier"] as? String

        // Clear with new anonymous ID
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)
        Owl.clearUser(newAnonymousId: true)

        Owl.info("after clear new", context: "clear_new_anon2")
        await Owl.shutdown()

        let afterEvents = try await queryEvents(context: "clear_new_anon2")
        let newAnonId = afterEvents.first?["user_identifier"] as? String

        XCTAssertNotNil(originalAnonId)
        XCTAssertNotNil(newAnonId)
        XCTAssertTrue(newAnonId?.hasPrefix(IdentityManager.anonymousIdPrefix) == true)
        XCTAssertNotEqual(originalAnonId, newAnonId,
                          "New anonymous ID should differ from original after clearUser(newAnonymousId: true)")
    }

    func testSetUserAfterClearUser() async throws {
        // Scenario: user logs in, logs out, sends anonymous events,
        // then a different user logs in on the same device.
        // Events between sessions should be claimed by the second user
        // (since they share the same anonymous ID after logout).
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        Owl.setUser("user-session-1")
        try await Task.sleep(nanoseconds: 1_000_000_000)

        // Logout with new anonymous ID (shared device scenario)
        Owl.clearUser(newAnonymousId: true)

        // Send an event between sessions (with the fresh anonymous ID)
        Owl.info("between sessions", context: "relogin")
        await Owl.shutdown()

        // Second user logs in
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)
        Owl.setUser("user-session-2")
        try await Task.sleep(nanoseconds: 1_000_000_000)

        Owl.info("second login", context: "relogin")
        await Owl.shutdown()

        let events = try await queryEvents(context: "relogin")

        let betweenEvent = events.first(where: { ($0["body"] as? String) == "between sessions" })
        let secondEvent = events.first(where: { ($0["body"] as? String) == "second login" })

        XCTAssertNotNil(betweenEvent)
        XCTAssertNotNil(secondEvent)

        // Between sessions was claimed by user-session-2 (same anonymous ID)
        XCTAssertEqual(betweenEvent?["user_identifier"] as? String, "user-session-2")

        // Second login should have the new user ID
        XCTAssertEqual(secondEvent?["user_identifier"] as? String, "user-session-2")
    }

    // MARK: - Restart & Persistence Tests

    func testOfflineQueuePersistenceAcrossRestart() async throws {
        // Simulate: events get stuck in the offline queue, app restarts, events flush on next launch
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        let queue = Owl._offlineQueue!
        let context = "offline_persist_\(UUID().uuidString.prefix(8))"

        // Manually enqueue events to the offline queue (simulates failed network send)
        let events = (0..<5).map { i in
            LogEvent(
                clientEventId: UUID().uuidString,
                userIdentifier: "offline-test-user",
                level: .info,
                source: "test",
                body: "persisted_event_\(i)",
                context: context,
                meta: nil,
                platform: .macos,
                osVersion: "15.0",
                appVersion: "1.0",
                buildNumber: "1",
                deviceModel: "Mac",
                locale: "en_US",
                timestamp: ISO8601DateFormatter().string(from: Date())
            )
        }
        await queue.enqueue(events)
        await queue.persistNow()

        // "Restart" the SDK — this destroys in-memory state but the disk file remains
        await Owl.reset()

        // Re-configure — the new OfflineQueue loads persisted events from disk
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        // Shutdown triggers flushAll which drains the offline queue
        await Owl.shutdown()

        // Verify events made it to the server
        let serverEvents = try await queryEvents(context: context)
        XCTAssertEqual(serverEvents.count, 5, "All 5 persisted events should have been flushed after restart")

        let bodies = Set(serverEvents.map { $0["body"] as? String ?? "" })
        for i in 0..<5 {
            XCTAssertTrue(bodies.contains("persisted_event_\(i)"),
                          "Event persisted_event_\(i) should have been flushed")
        }
    }

    func testShutdownFlushesAllBufferedEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        let context = "shutdown_load_\(UUID().uuidString.prefix(8))"
        let eventCount = 50

        // Rapid-fire events
        for i in 0..<eventCount {
            Owl.info("load_event_\(i)", context: context)
        }

        // Brief delay to let fire-and-forget Tasks enqueue events into the transport
        try await Task.sleep(nanoseconds: 500_000_000)

        // Shutdown should flush everything
        await Owl.shutdown()

        let serverEvents = try await queryEvents(context: context)
        XCTAssertEqual(serverEvents.count, eventCount,
                       "All \(eventCount) events should be flushed on shutdown")
    }

    // MARK: - Duplicate Filter Tests

    func testDuplicateFilterLimitsIdenticalEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        let context = "dup_filter_\(UUID().uuidString.prefix(8))"

        // Send 15 identical events — duplicate filter allows max 10 per 60s window
        for _ in 0..<15 {
            Owl.tracking("dup_body", context: context)
        }

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let serverEvents = try await queryEvents(context: context)
        XCTAssertEqual(serverEvents.count, 10,
                       "Duplicate filter should cap identical events at 10 per window")
    }

    // MARK: - Batch & Flush Tests

    func testEagerFlushAtBatchThreshold() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        let context = "eager_flush_\(UUID().uuidString.prefix(8))"

        // Send 25 unique events (exceeds batchSize of 20)
        for i in 0..<25 {
            Owl.info("eager_\(i)", context: context)
        }

        // Wait for eager flush to fire (triggered when buffer >= 20)
        // but don't call shutdown yet
        try await Task.sleep(nanoseconds: 3_000_000_000)

        let earlyEvents = try await queryEvents(context: context)
        XCTAssertGreaterThanOrEqual(earlyEvents.count, 20,
                                    "At least 20 events should have been eagerly flushed")

        // Now shutdown to flush the remainder
        await Owl.shutdown()

        let allEvents = try await queryEvents(context: context)
        XCTAssertEqual(allEvents.count, 25,
                       "All 25 events should be present after shutdown")
    }

    // MARK: - Concurrency Tests

    func testConcurrentEventTracking() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        let context = "concurrent_\(UUID().uuidString.prefix(8))"
        let tasksCount = 10
        let eventsPerTask = 5

        // Launch concurrent tasks that all track events simultaneously
        await withTaskGroup(of: Void.self) { group in
            for t in 0..<tasksCount {
                group.addTask {
                    for e in 0..<eventsPerTask {
                        Owl.info("concurrent_\(t)_\(e)", context: context)
                    }
                }
            }
        }

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let serverEvents = try await queryEvents(context: context)
        XCTAssertEqual(serverEvents.count, tasksCount * eventsPerTask,
                       "All \(tasksCount * eventsPerTask) concurrently tracked events should arrive")
    }

    // MARK: - Once-Tracking Persistence Tests

    func testOnceTrackingPersistsAcrossReset() async throws {
        let eventName = "once_persist_\(UUID().uuidString.prefix(8))"

        // Session 1: track once
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)
        Owl.once(eventName)
        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        // "Restart"
        await Owl.reset()

        // Session 2: try to track the same event again
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)
        Owl.once(eventName)
        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        // Query all tracking events and filter by body
        let events = try await queryEvents(level: "tracking")
        let matchingEvents = events.filter { ($0["body"] as? String) == eventName }
        XCTAssertEqual(matchingEvents.count, 1,
                       "once() should only send the event once, even across SDK resets")

        // Clean up UserDefaults to avoid polluting other test runs
        UserDefaults.standard.removeObject(forKey: "owlmetry.once.\(eventName)")
    }

    // MARK: - Meta Trimming Tests

    func testMetaTrimmingEndToEnd() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)

        let context = "meta_trim_\(UUID().uuidString.prefix(8))"
        let longValue = String(repeating: "x", count: 300)

        Owl.info("meta trim test", context: context, meta: ["long_value": longValue])

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let events = try await queryEvents(context: context)
        guard let event = events.first(where: { ($0["body"] as? String) == "meta trim test" }) else {
            XCTFail("Event not found")
            return
        }

        let meta = event["meta"] as? [String: String] ?? [:]
        let trimmedValue = meta["long_value"] ?? ""

        // SDK trims to 200 chars + " [TRIMMED 300]" (214 total),
        // then server slices to 200. Final result is 200 x's.
        XCTAssertEqual(trimmedValue.count, 200,
                       "Value should be trimmed to 200 chars (server-side trim)")
        XCTAssertEqual(trimmedValue, String(repeating: "x", count: 200),
                       "Trimmed value should be the first 200 characters")
    }

    // MARK: - Helpers

    private func waitForServer(timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let url = URL(string: "\(Self.testEndpoint)/health") {
                do {
                    let (_, response) = try await URLSession.shared.data(from: url)
                    if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                        return true
                    }
                } catch {
                    // Server not ready yet
                }
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        return false
    }

    private func queryEvents(
        level: String? = nil,
        context: String? = nil,
        user: String? = nil
    ) async throws -> [[String: Any]] {
        var components = URLComponents(string: "\(Self.testEndpoint)/v1/events")!
        var queryItems: [URLQueryItem] = []
        if let level { queryItems.append(URLQueryItem(name: "level", value: level)) }
        if let context { queryItems.append(URLQueryItem(name: "context", value: context)) }
        if let user { queryItems.append(URLQueryItem(name: "user", value: user)) }
        if !queryItems.isEmpty { components.queryItems = queryItems }

        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(Self.testAgentKey)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            XCTFail("Events query failed with status \(status)")
            return []
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["events"] as? [[String: Any]] ?? []
    }

    private func ingestEvents(_ events: [[String: Any]]) async throws {
        let url = URL(string: "\(Self.testEndpoint)/v1/ingest")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(Self.testClientKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = ["events": events]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            XCTFail("Ingest failed with status \(status)")
            return
        }
    }

    private func claimIdentity(anonymousId: String, userId: String) async throws -> [String: Any] {
        let (data, _) = try await claimIdentityRequest(anonymousId: anonymousId, userId: userId)
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private func claimIdentityRaw(anonymousId: String, userId: String) async throws -> (statusCode: Int, body: [String: Any]) {
        let (data, response) = try await claimIdentityRequest(anonymousId: anonymousId, userId: userId)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        return (status, body)
    }

    private func claimIdentityRequest(anonymousId: String, userId: String) async throws -> (Data, URLResponse) {
        let url = URL(string: "\(Self.testEndpoint)/v1/identity/claim")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(Self.testClientKey)", forHTTPHeaderField: "Authorization")

        let body: [String: String] = ["anonymous_id": anonymousId, "user_id": userId]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        return try await URLSession.shared.data(for: request)
    }
}
