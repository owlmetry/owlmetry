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
    static let testBundleId = "com.owlmetry.test"

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
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        Owl.info("SDK integration test - info", screenName: "roundtrip")
        Owl.error("SDK integration test - error", screenName: "roundtrip", customAttributes: ["source_module": "xcode"])
        Owl.warn("SDK integration test - warn", screenName: "roundtrip")

        await Owl.shutdown()

        let events = try await queryEvents(screenName: "roundtrip")

        XCTAssertGreaterThanOrEqual(events.count, 3, "Expected at least 3 events from SDK")

        let messages = events.map { $0["message"] as? String ?? "" }
        XCTAssertTrue(messages.contains("SDK integration test - info"))
        XCTAssertTrue(messages.contains("SDK integration test - error"))
        XCTAssertTrue(messages.contains("SDK integration test - warn"))

        // All events should have a user_id (anonymous ID)
        for event in events {
            let uid = event["user_id"] as? String
            XCTAssertNotNil(uid, "Every event should have a user_id")
            XCTAssertTrue(uid?.hasPrefix(IdentityManager.anonymousIdPrefix) == true, "Pre-login events should have anonymous ID")
        }

        // Verify device info was auto-populated
        if let firstEvent = events.first {
            XCTAssertNotNil(firstEvent["environment"])
            XCTAssertNotNil(firstEvent["os_version"])
            XCTAssertNotNil(firstEvent["device_model"])
            XCTAssertNotNil(firstEvent["locale"])
        }
    }

    func testTrackingEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        Owl.track("onboarding.step_1", customAttributes: ["slide": "intro"])
        Owl.track("onboarding.step_2", customAttributes: ["slide": "tutorial"])

        await Owl.shutdown()

        let events = try await queryEvents(level: "tracking")

        let messages = events.map { $0["message"] as? String ?? "" }
        XCTAssertTrue(messages.contains("onboarding.step_1"))
        XCTAssertTrue(messages.contains("onboarding.step_2"))
    }

    func testMetadataPreserved() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        Owl.info("custom attributes test", screenName: "checkout", customAttributes: ["item_count": "3", "currency": "USD"])

        await Owl.shutdown()

        let events = try await queryEvents(screenName: "checkout")

        guard let event = events.first(where: { ($0["message"] as? String) == "custom attributes test" }) else {
            XCTFail("Event not found")
            return
        }

        let attributes = event["custom_attributes"] as? [String: String] ?? [:]
        XCTAssertEqual(attributes["item_count"], "3")
        XCTAssertEqual(attributes["currency"], "USD")
    }

    func testClientEventIdDedup() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        Owl.info("dedup test event", screenName: "dedup")
        Owl.info("dedup test event", screenName: "dedup")

        await Owl.shutdown()

        let events = try await queryEvents(screenName: "dedup")
        XCTAssertGreaterThanOrEqual(events.count, 2)
    }

    // MARK: - Identity Tests

    func testAnonymousIdAutoAssigned() async throws {
        // Events should always have a user_id even without calling setUser
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        Owl.info("anon id test", screenName: "anon_auto")

        await Owl.shutdown()

        let events = try await queryEvents(screenName: "anon_auto")
        XCTAssertGreaterThanOrEqual(events.count, 1)

        let uid = events.first?["user_id"] as? String
        XCTAssertNotNil(uid)
        XCTAssertTrue(uid?.hasPrefix(IdentityManager.anonymousIdPrefix) == true,
                       "Event should have auto-generated anonymous ID")
    }

    func testAnonymousIdConsistentAcrossEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        Owl.info("consistent anon 1", screenName: "anon_consistent")
        Owl.info("consistent anon 2", screenName: "anon_consistent")
        Owl.info("consistent anon 3", screenName: "anon_consistent")

        await Owl.shutdown()

        let events = try await queryEvents(screenName: "anon_consistent")
        XCTAssertGreaterThanOrEqual(events.count, 3)

        let userIds = Set(events.compactMap { $0["user_id"] as? String })
        XCTAssertEqual(userIds.count, 1,
                       "All events in one session should have the same anonymous ID")
    }

    func testSetUserChangesIdentifier() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Send event with anonymous ID
        Owl.info("before login", screenName: "set_user")
        await Owl.shutdown()

        // Set real user and send another event
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)
        Owl.setUser("real-user-123")

        // Small delay to let claim request fire
        try await Task.sleep(nanoseconds: 1_000_000_000)

        Owl.info("after login", screenName: "set_user")
        await Owl.shutdown()

        let events = try await queryEvents(screenName: "set_user")
        XCTAssertGreaterThanOrEqual(events.count, 2)

        // The "after login" event should have the real user ID
        let afterLogin = events.first(where: { ($0["message"] as? String) == "after login" })
        XCTAssertEqual(afterLogin?["user_id"] as? String, "real-user-123")
    }

    func testIdentityClaimUpdatesAnonymousEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Send events before login
        Owl.info("pre-login event 1", screenName: "claim_test")
        Owl.info("pre-login event 2", screenName: "claim_test")
        Owl.warn("pre-login event 3", screenName: "claim_test")

        await Owl.shutdown()

        // Verify events have anonymous ID
        let preClaimEvents = try await queryEvents(screenName: "claim_test")
        XCTAssertGreaterThanOrEqual(preClaimEvents.count, 3)

        let anonId = preClaimEvents.first?["user_id"] as? String
        XCTAssertNotNil(anonId)
        XCTAssertTrue(anonId?.hasPrefix(IdentityManager.anonymousIdPrefix) == true)

        // Now "login" — this triggers the claim
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)
        Owl.setUser("claimed-user-456")

        // Wait for the claim to process
        try await Task.sleep(nanoseconds: 2_000_000_000)

        await Owl.shutdown()

        // Query events again — they should all now have the real user ID
        let postClaimEvents = try await queryEvents(screenName: "claim_test")
        XCTAssertGreaterThanOrEqual(postClaimEvents.count, 3)

        for event in postClaimEvents {
            let uid = event["user_id"] as? String
            XCTAssertEqual(uid, "claimed-user-456",
                           "Event '\(event["message"] as? String ?? "")' should have claimed user ID")
        }
    }

    func testClaimEndpointDirectly() async throws {
        // First ingest some events with an anonymous ID
        let anonId = "\(IdentityManager.anonymousIdPrefix)\(UUID().uuidString)"

        let ingestPayload: [[String: Any]] = [
            ["level": "info", "message": "direct claim test 1", "user_id": anonId, "screen_name": "direct_claim"],
            ["level": "info", "message": "direct claim test 2", "user_id": anonId, "screen_name": "direct_claim"],
        ]

        try await ingestEvents(ingestPayload)

        // Verify events exist with anonymous ID
        let preClaim = try await queryEvents(screenName: "direct_claim")
        XCTAssertEqual(preClaim.count, 2)
        XCTAssertEqual(preClaim.first?["user_id"] as? String, anonId)

        // Call claim endpoint
        let claimResponse = try await claimIdentity(anonymousId: anonId, userId: "direct-claimed-user")

        XCTAssertTrue(claimResponse["claimed"] as? Bool == true)
        XCTAssertEqual(claimResponse["events_reassigned_count"] as? Int, 2)

        // Verify events are updated
        let postClaim = try await queryEvents(screenName: "direct_claim")
        for event in postClaim {
            XCTAssertEqual(event["user_id"] as? String, "direct-claimed-user")
        }
    }

    func testClaimIsIdempotent() async throws {
        let anonId = "\(IdentityManager.anonymousIdPrefix)\(UUID().uuidString)"

        try await ingestEvents([
            ["level": "info", "message": "idempotent test", "user_id": anonId, "screen_name": "idempotent_claim"],
        ])

        // Claim once
        let first = try await claimIdentity(anonymousId: anonId, userId: "idempotent-user")
        XCTAssertTrue(first["claimed"] as? Bool == true)
        XCTAssertEqual(first["events_reassigned_count"] as? Int, 1)

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
            ["level": "info", "message": "test", "user_id": anonId, "screen_name": "reject_anon_user"],
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
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Set user then clear
        Owl.setUser("temp-user")
        try await Task.sleep(nanoseconds: 500_000_000)
        Owl.clearUser()

        Owl.info("after clear", screenName: "clear_user")
        await Owl.shutdown()

        let events = try await queryEvents(screenName: "clear_user")
        XCTAssertGreaterThanOrEqual(events.count, 1)

        let uid = events.first?["user_id"] as? String
        XCTAssertNotNil(uid)
        XCTAssertTrue(uid?.hasPrefix(IdentityManager.anonymousIdPrefix) == true,
                       "After clearUser, events should use anonymous ID again")
    }

    func testClearUserWithNewAnonymousId() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Send an event to capture the original anonymous ID
        Owl.info("before clear new", screenName: "clear_new_anon")
        await Owl.shutdown()

        let beforeEvents = try await queryEvents(screenName: "clear_new_anon")
        let originalAnonId = beforeEvents.first?["user_id"] as? String

        // Clear with new anonymous ID
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)
        Owl.clearUser(newAnonymousId: true)

        Owl.info("after clear new", screenName: "clear_new_anon2")
        await Owl.shutdown()

        let afterEvents = try await queryEvents(screenName: "clear_new_anon2")
        let newAnonId = afterEvents.first?["user_id"] as? String

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
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        Owl.setUser("user-session-1")
        try await Task.sleep(nanoseconds: 1_000_000_000)

        // Logout with new anonymous ID (shared device scenario)
        Owl.clearUser(newAnonymousId: true)

        // Send an event between sessions (with the fresh anonymous ID)
        Owl.info("between sessions", screenName: "relogin")
        await Owl.shutdown()

        // Second user logs in
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)
        Owl.setUser("user-session-2")
        try await Task.sleep(nanoseconds: 1_000_000_000)

        Owl.info("second login", screenName: "relogin")
        await Owl.shutdown()

        let events = try await queryEvents(screenName: "relogin")

        let betweenEvent = events.first(where: { ($0["message"] as? String) == "between sessions" })
        let secondEvent = events.first(where: { ($0["message"] as? String) == "second login" })

        XCTAssertNotNil(betweenEvent)
        XCTAssertNotNil(secondEvent)

        // Between sessions was claimed by user-session-2 (same anonymous ID)
        XCTAssertEqual(betweenEvent?["user_id"] as? String, "user-session-2")

        // Second login should have the new user ID
        XCTAssertEqual(secondEvent?["user_id"] as? String, "user-session-2")
    }

    // MARK: - Compression Tests

    func testGzipCompressionDataIntegrity() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let screenName = "gzip_integrity_\(UUID().uuidString.prefix(8))"

        // Send enough events with rich custom attributes to guarantee the batch
        // exceeds the 512-byte compression threshold
        for i in 0..<10 {
            Owl.info(
                "gzip_event_\(i)_padding_\(String(repeating: "x", count: 50))",
                screenName: screenName,
                customAttributes: [
                    "index": "\(i)",
                    "tag": "compression-test",
                    "payload": String(repeating: "y", count: 80),
                ]
            )
        }

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let serverEvents = try await queryEvents(screenName: screenName)
        XCTAssertEqual(serverEvents.count, 10, "All 10 events should survive gzip round-trip")

        // Verify every event's data arrived intact
        for i in 0..<10 {
            let expected = "gzip_event_\(i)_padding_\(String(repeating: "x", count: 50))"
            let match = serverEvents.first(where: {
                ($0["custom_attributes"] as? [String: String])?["index"] == "\(i)"
            })
            XCTAssertNotNil(match, "Event with index \(i) should exist")
            XCTAssertEqual(match?["message"] as? String, expected,
                           "Event message should survive compression")
            let attributes = match?["custom_attributes"] as? [String: String] ?? [:]
            XCTAssertEqual(attributes["tag"], "compression-test")
            XCTAssertEqual(attributes["payload"], String(repeating: "y", count: 80))
        }
    }

    // MARK: - Restart & Persistence Tests

    func testOfflineQueuePersistenceAcrossRestart() async throws {
        // Simulate: events get stuck in the offline queue, app restarts, events flush on next launch
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let queue = Owl._offlineQueue!
        let screenName = "offline_persist_\(UUID().uuidString.prefix(8))"

        // Manually enqueue events to the offline queue (simulates failed network send)
        let events = (0..<5).map { i in
            LogEvent(
                clientEventId: UUID().uuidString,
                sessionId: UUID().uuidString,
                userId: "offline-test-user",
                level: .info,
                sourceModule: "test",
                message: "persisted_event_\(i)",
                screenName: screenName,
                customAttributes: nil,
                environment: .macos,
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
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Shutdown triggers flushAll which drains the offline queue
        await Owl.shutdown()

        // Verify events made it to the server
        let serverEvents = try await queryEvents(screenName: screenName)
        XCTAssertEqual(serverEvents.count, 5, "All 5 persisted events should have been flushed after restart")

        let messages = Set(serverEvents.map { $0["message"] as? String ?? "" })
        for i in 0..<5 {
            XCTAssertTrue(messages.contains("persisted_event_\(i)"),
                          "Event persisted_event_\(i) should have been flushed")
        }
    }

    func testShutdownFlushesAllBufferedEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let screenName = "shutdown_load_\(UUID().uuidString.prefix(8))"
        let eventCount = 50

        // Rapid-fire events
        for i in 0..<eventCount {
            Owl.info("load_event_\(i)", screenName: screenName)
        }

        // Brief delay to let fire-and-forget Tasks enqueue events into the transport
        try await Task.sleep(nanoseconds: 500_000_000)

        // Shutdown should flush everything
        await Owl.shutdown()

        let serverEvents = try await queryEvents(screenName: screenName)
        XCTAssertEqual(serverEvents.count, eventCount,
                       "All \(eventCount) events should be flushed on shutdown")
    }

    // MARK: - Duplicate Filter Tests

    func testDuplicateFilterLimitsIdenticalEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let screenName = "dup_filter_\(UUID().uuidString.prefix(8))"

        // Send 15 identical events — duplicate filter allows max 10 per 60s window
        for _ in 0..<15 {
            Owl.tracking("dup_message", screenName: screenName)
        }

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let serverEvents = try await queryEvents(screenName: screenName)
        XCTAssertEqual(serverEvents.count, 10,
                       "Duplicate filter should cap identical events at 10 per window")
    }

    // MARK: - Batch & Flush Tests

    func testEagerFlushAtBatchThreshold() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let screenName = "eager_flush_\(UUID().uuidString.prefix(8))"

        // Send 25 unique events (exceeds batchSize of 20)
        for i in 0..<25 {
            Owl.info("eager_\(i)", screenName: screenName)
        }

        // Wait for eager flush to fire (triggered when buffer >= 20)
        // but don't call shutdown yet
        try await Task.sleep(nanoseconds: 3_000_000_000)

        let earlyEvents = try await queryEvents(screenName: screenName)
        XCTAssertGreaterThanOrEqual(earlyEvents.count, 20,
                                    "At least 20 events should have been eagerly flushed")

        // Now shutdown to flush the remainder
        await Owl.shutdown()

        let allEvents = try await queryEvents(screenName: screenName)
        XCTAssertEqual(allEvents.count, 25,
                       "All 25 events should be present after shutdown")
    }

    // MARK: - Concurrency Tests

    func testConcurrentEventTracking() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let screenName = "concurrent_\(UUID().uuidString.prefix(8))"
        let tasksCount = 10
        let eventsPerTask = 5

        // Launch concurrent tasks that all track events simultaneously
        await withTaskGroup(of: Void.self) { group in
            for t in 0..<tasksCount {
                group.addTask {
                    for e in 0..<eventsPerTask {
                        Owl.info("concurrent_\(t)_\(e)", screenName: screenName)
                    }
                }
            }
        }

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let serverEvents = try await queryEvents(screenName: screenName)
        XCTAssertEqual(serverEvents.count, tasksCount * eventsPerTask,
                       "All \(tasksCount * eventsPerTask) concurrently tracked events should arrive")
    }

    // MARK: - Once-Tracking Persistence Tests

    func testOnceTrackingPersistsAcrossReset() async throws {
        let eventName = "once_persist_\(UUID().uuidString.prefix(8))"

        // Session 1: track once
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)
        Owl.trackOnce(eventName)
        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        // "Restart"
        await Owl.reset()

        // Session 2: try to track the same event again
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)
        Owl.trackOnce(eventName)
        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        // Query all tracking events and filter by message
        let events = try await queryEvents(level: "tracking")
        let matchingEvents = events.filter { ($0["message"] as? String) == eventName }
        XCTAssertEqual(matchingEvents.count, 1,
                       "once() should only send the event once, even across SDK resets")

        // Clean up UserDefaults to avoid polluting other test runs
        UserDefaults.standard.removeObject(forKey: "owlmetry.once.\(eventName)")
    }

    // MARK: - Custom Attribute Trimming Tests

    func testCustomAttributeTrimmingEndToEnd() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let screenName = "attr_trim_\(UUID().uuidString.prefix(8))"
        let longValue = String(repeating: "x", count: 300)

        Owl.info("attribute trim test", screenName: screenName, customAttributes: ["long_value": longValue])

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let events = try await queryEvents(screenName: screenName)
        guard let event = events.first(where: { ($0["message"] as? String) == "attribute trim test" }) else {
            XCTFail("Event not found")
            return
        }

        let attributes = event["custom_attributes"] as? [String: String] ?? [:]
        let trimmedValue = attributes["long_value"] ?? ""

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
        screenName: String? = nil,
        user: String? = nil
    ) async throws -> [[String: Any]] {
        var components = URLComponents(string: "\(Self.testEndpoint)/v1/events")!
        var queryItems: [URLQueryItem] = []
        if let level { queryItems.append(URLQueryItem(name: "level", value: level)) }
        if let screenName { queryItems.append(URLQueryItem(name: "screen_name", value: screenName)) }
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

        // Auto-inject session_id if not present
        let enrichedEvents = events.map { event -> [String: Any] in
            var e = event
            if e["session_id"] == nil { e["session_id"] = UUID().uuidString }
            return e
        }
        let body: [String: Any] = ["bundle_id": Self.testBundleId, "events": enrichedEvents]
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
