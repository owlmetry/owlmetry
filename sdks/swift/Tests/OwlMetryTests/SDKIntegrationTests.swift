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
        // Wait briefly for server to be ready
        let ready = await waitForServer(timeout: 10)
        guard ready else {
            throw XCTSkip("Server not running at \(Self.testEndpoint) — run via pnpm test:sdk")
        }
    }

    // MARK: - Tests

    func testFullRoundTrip() async throws {
        // 1. Configure SDK with real server
        try Owl.configure(endpoint: Self.testEndpoint, apiKey: Self.testClientKey)
        Owl.setUserIdentifier("integration-test-user")

        // 2. Send events using the real SDK methods
        Owl.info("SDK integration test - info", context: "integration")
        Owl.error("SDK integration test - error", context: "integration", meta: ["source": "xcode"])
        Owl.warn("SDK integration test - warn", context: "integration")

        // 3. Flush to ensure events are sent
        await Owl.shutdown()

        // 4. Query the server to verify events arrived
        let events = try await queryEvents(context: "integration")

        XCTAssertGreaterThanOrEqual(events.count, 3, "Expected at least 3 events from SDK")

        let bodies = events.map { $0["body"] as? String ?? "" }
        XCTAssertTrue(bodies.contains("SDK integration test - info"))
        XCTAssertTrue(bodies.contains("SDK integration test - error"))
        XCTAssertTrue(bodies.contains("SDK integration test - warn"))

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

        // Send the same event body; each call generates a unique client_event_id
        // so they should NOT be deduped (they're distinct events)
        Owl.info("dedup test event", context: "dedup")
        Owl.info("dedup test event", context: "dedup")

        await Owl.shutdown()

        // Both should arrive since they have different client_event_ids
        let events = try await queryEvents(context: "dedup")
        XCTAssertGreaterThanOrEqual(events.count, 2)
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
        context: String? = nil
    ) async throws -> [[String: Any]] {
        var components = URLComponents(string: "\(Self.testEndpoint)/v1/events")!
        var queryItems: [URLQueryItem] = []
        if let level { queryItems.append(URLQueryItem(name: "level", value: level)) }
        if let context { queryItems.append(URLQueryItem(name: "context", value: context)) }
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
}
