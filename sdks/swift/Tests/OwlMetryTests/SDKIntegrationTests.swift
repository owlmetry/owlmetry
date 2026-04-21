import XCTest
import CryptoKit
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
        Owl.error("SDK integration test - error", screenName: "roundtrip", attributes: ["source_module": "xcode"])
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

    func testMetricEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        Owl.recordMetric("onboarding", attributes: ["step": "intro"])
        let op = Owl.startOperation("photo-conversion", attributes: ["format": "heic"])
        op.complete(attributes: ["output": "jpeg"])

        await Owl.shutdown()

        let events = try await queryEvents(level: "info")

        let messages = events.map { $0["message"] as? String ?? "" }
        XCTAssertTrue(messages.contains("metric:onboarding:record"))
        XCTAssertTrue(messages.contains("metric:photo-conversion:start"))
        XCTAssertTrue(messages.contains("metric:photo-conversion:complete"))
    }

    func testMetadataPreserved() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        Owl.info("custom attributes test", screenName: "checkout", attributes: ["item_count": "3", "currency": "USD"])

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

        // Set user then clear. Pass newAnonymousId so future events aren't
        // re-attributed to "temp-user" server-side via claimed_from: once the
        // device anon id has been absorbed into a real user, the server keeps
        // rewriting events under that anon id to the real user on ingest.
        // Rotating the anon is the correct "shared device" logout flow.
        Owl.setUser("temp-user")
        try await Task.sleep(nanoseconds: 500_000_000)
        Owl.clearUser(newAnonymousId: true)

        Owl.info("after clear", screenName: "clear_user")
        await Owl.shutdown()

        let events = try await queryEvents(screenName: "clear_user")
        XCTAssertGreaterThanOrEqual(events.count, 1)

        let uid = events.first?["user_id"] as? String
        XCTAssertNotNil(uid)
        XCTAssertTrue(uid?.hasPrefix(IdentityManager.anonymousIdPrefix) == true,
                       "After clearUser(newAnonymousId: true), events should use the fresh anonymous ID")
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
                attributes: [
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
                isDev: true,
                experiments: nil,
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
            Owl.info("dup_message", screenName: screenName)
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

    // MARK: - Operation Lifecycle Tests

    func testOperationLifecycleEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let screenName = "op_lifecycle_\(UUID().uuidString.prefix(8))"

        // Start an operation and fail it
        let op = Owl.startOperation("test-op", attributes: ["input": "data"])
        op.fail(error: "timeout")

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        // Query events — start goes as info, fail goes as error
        let infoEvents = try await queryEvents(level: "info")
        let errorEvents = try await queryEvents(level: "error")

        let startMessages = infoEvents.compactMap { $0["message"] as? String }
        let failMessages = errorEvents.compactMap { $0["message"] as? String }

        XCTAssertTrue(startMessages.contains("metric:test-op:start"),
                       "Start event should be sent as info")
        XCTAssertTrue(failMessages.contains("metric:test-op:fail"),
                       "Fail event should be sent as error")
    }

    // MARK: - Custom Attribute Trimming Tests

    func testCustomAttributeTrimmingEndToEnd() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let screenName = "attr_trim_\(UUID().uuidString.prefix(8))"
        let longValue = String(repeating: "x", count: 300)

        Owl.info("attribute trim test", screenName: screenName, attributes: ["long_value": longValue])

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let events = try await queryEvents(screenName: screenName)
        guard let event = events.first(where: { ($0["message"] as? String) == "attribute trim test" }) else {
            XCTFail("Event not found")
            return
        }

        let attributes = event["custom_attributes"] as? [String: String] ?? [:]
        let trimmedValue = attributes["long_value"] ?? ""

        // SDK silently trims to 200 chars, matching server behavior
        XCTAssertEqual(trimmedValue.count, 200,
                       "Value should be trimmed to 200 chars")
        XCTAssertEqual(trimmedValue, String(repeating: "x", count: 200),
                       "Trimmed value should be the first 200 characters")
    }

    // MARK: - Network Tracking Tests

    func testNetworkTrackingEmitsEvents() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Make a completion-handler-based request (the kind we instrument)
        let healthURL = URL(string: "\(Self.testEndpoint)/health")!
        let expectation = XCTestExpectation(description: "Health request completes")
        URLSession.shared.dataTask(with: healthURL) { _, _, _ in
            expectation.fulfill()
        }.resume()
        await fulfillment(of: [expectation], timeout: 5)

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let events = try await queryEvents(level: "debug")
        let networkEvents = events.filter { ($0["message"] as? String) == "sdk:network_request" }

        XCTAssertGreaterThanOrEqual(networkEvents.count, 1, "Should have at least 1 network tracking event")

        guard let event = networkEvents.first else { return }
        let attrs = event["custom_attributes"] as? [String: String] ?? [:]

        XCTAssertEqual(attrs["_http_method"], "GET")
        XCTAssertNotNil(attrs["_http_status"], "Should have status code")
        XCTAssertNotNil(attrs["_http_duration_ms"], "Should have duration")
        XCTAssertNotNil(attrs["_http_url"], "Should have sanitized URL")

        // URL should not contain query params
        let trackedURL = attrs["_http_url"] ?? ""
        XCTAssertFalse(trackedURL.contains("?"), "URL should have query params stripped")
        XCTAssertTrue(trackedURL.contains("/health"), "URL should preserve path")
    }

    func testNetworkTrackingDoesNotTrackSDKRequests() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Send events which trigger SDK requests to the ingest endpoint
        Owl.info("trigger sdk request", screenName: "net_filter_test")

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let events = try await queryEvents(level: "debug")
        let networkEvents = events.filter { ($0["message"] as? String) == "sdk:network_request" }

        // None of the network events should reference the test endpoint
        let endpointHost = URL(string: Self.testEndpoint)!.host!
        for event in networkEvents {
            let attrs = event["custom_attributes"] as? [String: String] ?? [:]
            let url = attrs["_http_url"] ?? ""
            XCTAssertFalse(url.contains(endpointHost),
                           "SDK's own requests to \(endpointHost) should not be tracked")
        }
    }

    func testNetworkTrackingDisabledByFlag() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId, networkTrackingEnabled: false)

        // Make a completion-handler-based request
        let healthURL = URL(string: "\(Self.testEndpoint)/health")!
        let expectation = XCTestExpectation(description: "Health request completes")
        URLSession.shared.dataTask(with: healthURL) { _, _, _ in
            expectation.fulfill()
        }.resume()
        await fulfillment(of: [expectation], timeout: 5)

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let events = try await queryEvents(level: "debug")
        let networkEvents = events.filter { ($0["message"] as? String) == "sdk:network_request" }

        XCTAssertEqual(networkEvents.count, 0,
                       "No network events should be emitted when tracking is disabled")
    }

    func testNetworkTrackingCapturesErrorResponses() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Hit a path that returns 404
        let notFoundURL = URL(string: "\(Self.testEndpoint)/nonexistent-path-\(UUID().uuidString.prefix(8))")!
        let expectation = XCTestExpectation(description: "404 request completes")
        URLSession.shared.dataTask(with: notFoundURL) { _, _, _ in
            expectation.fulfill()
        }.resume()
        await fulfillment(of: [expectation], timeout: 5)

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        // 4xx responses are logged as warn
        let warnEvents = try await queryEvents(level: "warn")
        let networkWarns = warnEvents.filter { ($0["message"] as? String) == "sdk:network_request" }

        XCTAssertGreaterThanOrEqual(networkWarns.count, 1, "404 should produce a warn-level network event")

        if let event = networkWarns.first {
            let attrs = event["custom_attributes"] as? [String: String] ?? [:]
            XCTAssertEqual(attrs["_http_status"], "404")
        }
    }

    func testNetworkTrackingURLRequestOverload() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Use the URLRequest overload (vs the URL overload)
        var request = URLRequest(url: URL(string: "\(Self.testEndpoint)/health")!)
        request.httpMethod = "GET"
        let expectation = XCTestExpectation(description: "URLRequest-based request completes")
        URLSession.shared.dataTask(with: request) { _, _, _ in
            expectation.fulfill()
        }.resume()
        await fulfillment(of: [expectation], timeout: 5)

        try await Task.sleep(nanoseconds: 500_000_000)
        await Owl.shutdown()

        let events = try await queryEvents(level: "debug")
        let networkEvents = events.filter { ($0["message"] as? String) == "sdk:network_request" }

        XCTAssertGreaterThanOrEqual(networkEvents.count, 1, "URLRequest overload should also be tracked")
    }

    // MARK: - User Properties Tests

    func testSetUserProperties() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Set a known user so we can query properties
        Owl.setUser("props-test-user")

        // Emit an event to ensure the user exists in app_users
        Owl.info("properties test event", screenName: "props-test")
        await Owl.shutdown()

        // Set properties
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)
        Owl.setUser("props-test-user")
        Owl.setUserProperties(["plan": "premium", "org": "acme"])

        // Wait for the fire-and-forget request to complete
        try await Task.sleep(nanoseconds: 1_000_000_000)
        await Owl.shutdown()

        // Query the user's properties via the app-users endpoint
        let users = try await queryAppUsers()
        let user = users.first { ($0["user_id"] as? String) == "props-test-user" }
        XCTAssertNotNil(user, "Expected to find user 'props-test-user'")

        let properties = user?["properties"] as? [String: String]
        XCTAssertEqual(properties?["plan"], "premium")
        XCTAssertEqual(properties?["org"], "acme")
    }

    func testSetUserPropertiesMerge() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)
        Owl.setUser("merge-test-user")
        Owl.info("merge test", screenName: "merge-test")
        await Owl.shutdown()

        // Set initial properties
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)
        Owl.setUser("merge-test-user")
        Owl.setUserProperties(["plan": "free", "org": "acme"])
        try await Task.sleep(nanoseconds: 1_000_000_000)

        // Update one property, add another — org should be preserved
        Owl.setUserProperties(["plan": "premium", "role": "admin"])
        try await Task.sleep(nanoseconds: 1_000_000_000)
        await Owl.shutdown()

        let users = try await queryAppUsers()
        let user = users.first { ($0["user_id"] as? String) == "merge-test-user" }
        let properties = user?["properties"] as? [String: String]
        XCTAssertEqual(properties?["plan"], "premium", "plan should be updated")
        XCTAssertEqual(properties?["org"], "acme", "org should be preserved")
        XCTAssertEqual(properties?["role"], "admin", "role should be added")
    }

    // MARK: - Attachments

    func testErrorAttachmentFromData() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let payload = Data("hello bytes".utf8)
        let screenName = "attach_data_\(UUID().uuidString.prefix(8))"
        Owl.error(
            "attach-from-data",
            screenName: screenName,
            attachments: [OwlAttachment(data: payload, name: "hello.txt", contentType: "text/plain")]
        )
        await Owl.shutdown()

        let events = try await queryEvents(screenName: screenName)
        XCTAssertGreaterThanOrEqual(events.count, 1, "Expected the error event to be ingested")
        guard let clientEventId = events.first?["client_event_id"] as? String else {
            XCTFail("Event missing client_event_id")
            return
        }

        let attachments = try await waitForAttachments(eventClientId: clientEventId, expectedCount: 1)
        XCTAssertEqual(attachments.count, 1)
        let a = attachments[0]
        XCTAssertEqual(a["original_filename"] as? String, "hello.txt")
        XCTAssertEqual(a["content_type"] as? String, "text/plain")
        XCTAssertEqual(a["size_bytes"] as? Int, payload.count)
        XCTAssertNotNil(a["uploaded_at"] as? String, "Attachment should be uploaded (uploaded_at set)")
        XCTAssertEqual(a["sha256"] as? String, sha256Hex(payload))
    }

    func testErrorAttachmentFromFileURL() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let tempDir = FileManager.default.temporaryDirectory
        let fileName = "owl-test-\(UUID().uuidString).txt"
        let fileURL = tempDir.appendingPathComponent(fileName)
        let payload = Data("file-based attachment".utf8)
        try payload.write(to: fileURL)
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let screenName = "attach_file_\(UUID().uuidString.prefix(8))"
        Owl.error(
            "attach-from-file",
            screenName: screenName,
            attachments: [OwlAttachment(fileURL: fileURL)]
        )
        await Owl.shutdown()

        let events = try await queryEvents(screenName: screenName)
        XCTAssertGreaterThanOrEqual(events.count, 1)
        guard let clientEventId = events.first?["client_event_id"] as? String else {
            XCTFail("Event missing client_event_id")
            return
        }

        let attachments = try await waitForAttachments(eventClientId: clientEventId, expectedCount: 1)
        XCTAssertEqual(attachments.count, 1)
        let a = attachments[0]
        XCTAssertEqual(a["original_filename"] as? String, fileName,
                       "Filename should default to the URL's lastPathComponent")
        XCTAssertEqual(a["content_type"] as? String, "text/plain",
                       "Content type should be inferred from .txt extension")
        XCTAssertEqual(a["size_bytes"] as? Int, payload.count)
    }

    func testMultipleAttachmentsOnOneEvent() async throws {
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        let first = OwlAttachment(data: Data("first".utf8), name: "a.txt", contentType: "text/plain")
        let second = OwlAttachment(data: Data("second".utf8), name: "b.txt", contentType: "text/plain")
        let screenName = "attach_multi_\(UUID().uuidString.prefix(8))"
        Owl.error(
            "attach-multi",
            screenName: screenName,
            attachments: [first, second]
        )
        await Owl.shutdown()

        let events = try await queryEvents(screenName: screenName)
        guard let clientEventId = events.first?["client_event_id"] as? String else {
            XCTFail("Event missing client_event_id")
            return
        }

        let attachments = try await waitForAttachments(eventClientId: clientEventId, expectedCount: 2)
        XCTAssertEqual(attachments.count, 2)
        let names = Set(attachments.compactMap { $0["original_filename"] as? String })
        XCTAssertEqual(names, Set(["a.txt", "b.txt"]))
    }

    func testOversizedAttachmentSkippedClientSide() async throws {
        // Construct an uploader with a tiny cap, feed it a 1 KB attachment, assert no row is created.
        // This exercises the SDK-side size guard without allocating 250 MB.
        guard let endpoint = URL(string: Self.testEndpoint) else {
            XCTFail("Invalid endpoint")
            return
        }
        let uploader = AttachmentUploader(
            endpoint: endpoint,
            apiKey: Self.testClientKey,
            sdkHardCapBytes: 16
        )

        let clientEventId = UUID().uuidString
        let bigPayload = Data(count: 1024)
        let attachment = OwlAttachment(data: bigPayload, name: "big.bin", contentType: "application/octet-stream")

        await uploader.enqueue(clientEventId: clientEventId, userId: nil, isDev: true, attachments: [attachment])

        // Give the uploader a beat to drain (it won't send anything, but we don't want to race the skip).
        try await Task.sleep(nanoseconds: 1_500_000_000)

        let attachments = try await queryAttachments(eventClientId: clientEventId)
        XCTAssertEqual(attachments.count, 0, "Oversized attachment should be skipped client-side")
    }

    // MARK: - Helpers

    private func queryAttachments(eventClientId: String) async throws -> [[String: Any]] {
        var components = URLComponents(string: "\(Self.testEndpoint)/v1/attachments")!
        components.queryItems = [URLQueryItem(name: "event_client_id", value: eventClientId)]

        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(Self.testAgentKey)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            XCTFail("Attachments query failed with status \(status)")
            return []
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["attachments"] as? [[String: Any]] ?? []
    }

    private func waitForAttachments(
        eventClientId: String,
        expectedCount: Int,
        timeout: TimeInterval = 10
    ) async throws -> [[String: Any]] {
        let deadline = Date().addingTimeInterval(timeout)
        var attachments: [[String: Any]] = []
        while Date() < deadline {
            attachments = try await queryAttachments(eventClientId: eventClientId)
            let uploaded = attachments.filter { $0["uploaded_at"] is String }
            if uploaded.count >= expectedCount {
                return attachments
            }
            try? await Task.sleep(nanoseconds: 300_000_000)
        }
        return attachments
    }

    private func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func queryAppUsers() async throws -> [[String: Any]] {
        let url = URL(string: "\(Self.testEndpoint)/v1/app-users?data_mode=all")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(Self.testAgentKey)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            XCTFail("App users query failed with status \(status)")
            return []
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["users"] as? [[String: Any]] ?? []
    }

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

    // MARK: - Late-arriving anon event race (regression coverage)

    /// Simulates the offline-queue race that bit production: an event tagged
    /// with the anon id arrives at /v1/ingest *after* /v1/identity/claim has
    /// already committed. The server must resolve the anon id through
    /// app_users.claimed_from and attribute the event to the real user.
    func testLateAnonEventRewrittenViaClaimedFrom() async throws {
        let anonId = "\(IdentityManager.anonymousIdPrefix)\(UUID().uuidString)"
        let realId = "late-arrival-real-\(UUID().uuidString)"

        // Anchor event + claim so claimed_from is populated.
        try await ingestEvents([
            ["level": "info", "message": "anchor", "user_id": anonId, "screen_name": "late_race"],
        ])
        let claimResponse = try await claimIdentity(anonymousId: anonId, userId: realId)
        XCTAssertTrue(claimResponse["claimed"] as? Bool == true)

        // Late anon-tagged event (as if flushed from the on-disk offline queue).
        try await ingestEvents([
            ["level": "info", "message": "late offline event", "user_id": anonId, "screen_name": "late_race"],
        ])

        let events = try await queryEvents(screenName: "late_race")
        XCTAssertEqual(events.count, 2)
        for event in events {
            XCTAssertEqual(event["user_id"] as? String, realId,
                           "Late anon event should be rewritten to real user id via claimed_from")
        }
    }

    /// Exercises the SDK-side startup reclaim: after a previous session saved
    /// a real user id, reconfiguring the SDK should fire an idempotent
    /// claimIdentity call even without an explicit setUser. We pre-ingest an
    /// anon event, persist a saved user id, then configure() and verify the
    /// events were re-attributed.
    func testStartupReclaimIdempotentWhenSavedUserIdPresent() async throws {
        let anonId = IdentityManager.anonymousId() // install the current anon id
        let realId = "startup-reclaim-\(UUID().uuidString)"

        // Pre-seed an anon event directly via the ingest endpoint.
        try await ingestEvents([
            ["level": "info", "message": "before restart", "user_id": anonId, "screen_name": "startup_reclaim"],
        ])

        // Persist a saved user id as if a prior session's setUser had run but
        // the claim POST never succeeded.
        IdentityManager.saveUserId(realId)

        // Reconfigure — this should fire the startup reclaim.
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey, bundleId: Self.testBundleId)

        // Give the claim Task a moment to complete.
        try await Task.sleep(nanoseconds: 2_000_000_000)

        await Owl.shutdown()

        let events = try await queryEvents(screenName: "startup_reclaim")
        XCTAssertGreaterThanOrEqual(events.count, 1)
        let before = events.first(where: { ($0["message"] as? String) == "before restart" })
        XCTAssertEqual(before?["user_id"] as? String, realId,
                       "Pre-restart anon event should be reassigned by the startup reclaim")
    }

    private func queryEvents(
        level: String? = nil,
        screenName: String? = nil,
        user: String? = nil
    ) async throws -> [[String: Any]] {
        var components = URLComponents(string: "\(Self.testEndpoint)/v1/events")!
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "data_mode", value: "all"),
        ]
        if let level { queryItems.append(URLQueryItem(name: "level", value: level)) }
        if let screenName { queryItems.append(URLQueryItem(name: "screen_name", value: screenName)) }
        if let user { queryItems.append(URLQueryItem(name: "user", value: user)) }
        components.queryItems = queryItems

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
