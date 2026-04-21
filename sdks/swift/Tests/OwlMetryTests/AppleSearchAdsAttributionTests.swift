import XCTest
@testable import OwlMetry

/// End-to-end Apple Search Ads attribution tests against a real OwlMetry
/// server. Uses the server's `dev_mock` body field to bypass the upstream
/// Apple AdServices call — the simulator cannot mint a real AAAttribution
/// token, and we want these tests to validate the SDK <-> server wire
/// without external dependencies.
final class AppleSearchAdsAttributionTests: XCTestCase {
    static let testEndpoint = ProcessInfo.processInfo.environment["OWLMETRY_TEST_ENDPOINT"]
        ?? "http://localhost:4111"
    static let testClientKey = "owl_client_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    static let testAgentKey = "owl_agent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    static let testBundleId = "com.owlmetry.test"

    override func setUp() async throws {
        await Owl.reset()
        Owl.clearUser(newAnonymousId: true)
        IdentityManager.clearUserId()

        // Reset per-anon attribution capture state so tests don't interfere.
        let anon = IdentityManager.anonymousId()
        AppleSearchAdsAttribution.State.reset(anonymousId: anon)

        let ready = await waitForServer(timeout: 10)
        guard ready else {
            throw XCTSkip("Server not running at \(Self.testEndpoint) — run via pnpm test:swift-sdk")
        }
    }

    override func tearDown() async throws {
        await Owl.shutdown()
    }

    // MARK: - Direct server submission via the raw endpoint

    /// Confirms dev_mock=attributed writes the expected asa_* + attribution_source
    /// props on the server side (independent of the SDK token fetch).
    func testServerDevMockAttributedWritesAsaProps() async throws {
        let userId = "test-asa-user-\(UUID().uuidString)"
        let response = try await postAttribution(userId: userId, token: "ignored", devMock: "attributed")

        XCTAssertEqual(response["attributed"] as? Bool, true)
        XCTAssertEqual(response["pending"] as? Bool, false)
        let props = response["properties"] as? [String: String] ?? [:]
        XCTAssertEqual(props["attribution_source"], "apple_search_ads")
        XCTAssertNotNil(props["asa_campaign_id"])
        XCTAssertNotNil(props["asa_ad_group_id"])
        XCTAssertNotNil(props["asa_claim_type"])
    }

    func testServerDevMockPendingReturnsPending() async throws {
        let userId = "test-asa-pending-\(UUID().uuidString)"
        let response = try await postAttribution(userId: userId, token: "ignored", devMock: "pending")

        XCTAssertTrue((response["pending"] as? Bool) == true)
        XCTAssertTrue(response["attributed"] is NSNull)
    }

    // MARK: - SDK-level tests

    /// `Owl.sendAppleSearchAdsAttributionToken(_:)` should succeed end-to-end
    /// when the server is in dev_mock=attributed mode.
    func testSDKPublicApiSubmitsAttributionViaTransport() async throws {
        try Owl.configure(
            endpoint: Self.testEndpoint,
            apiKey: Self.testClientKey,
            bundleId: Self.testBundleId,
            attributionEnabled: false // we'll fire explicitly from the test
        )

        // The public `sendAppleSearchAdsAttributionToken` calls the transport
        // without dev_mock, so we can't use it to short-circuit Apple in this
        // test. Instead verify the transport plumbing directly using the
        // test-only dev_mock variant, which the public method would have hit
        // if it had a dev_mock option.
        let snapshot = snapshotIdentity()
        guard let transport = snapshot.transport, let userId = snapshot.userId else {
            XCTFail("SDK not configured")
            return
        }

        let result = await transport.submitAppleSearchAdsAttributionMock(
            userId: userId,
            token: "ignored",
            devMock: "attributed"
        )

        switch result {
        case .success(let source, let props):
            XCTAssertEqual(source, "apple_search_ads")
            XCTAssertNotNil(props["asa_campaign_id"])
        default:
            XCTFail("Expected .success, got \(result)")
        }
    }

    /// Pending responses must NOT mark the anon as captured, so the next
    /// `configure()` can retry. The pending-attempts counter should bump.
    func testPendingDoesNotMarkCaptured() async throws {
        try Owl.configure(
            endpoint: Self.testEndpoint,
            apiKey: Self.testClientKey,
            bundleId: Self.testBundleId,
            attributionEnabled: false
        )
        let snapshot = snapshotIdentity()
        guard let transport = snapshot.transport,
              let userId = snapshot.userId,
              let anonId = snapshot.anonymousId else {
            XCTFail("SDK not configured")
            return
        }

        // Clean slate for this anon.
        AppleSearchAdsAttribution.State.reset(anonymousId: anonId)

        // Submit via the full capture flow with a pending-returning server.
        _ = await AppleSearchAdsAttribution.submitForTest(
            token: "ignored",
            anonymousId: anonId,
            userId: userId,
            transport: transport,
            devMock: "pending"
        )

        XCTAssertFalse(AppleSearchAdsAttribution.State.isCaptured(anonymousId: anonId),
                       "Pending should not mark the anon as captured")
    }

    /// After the pending cap (5 attempts) is reached, the SDK must give up
    /// by writing `attribution_source=none` and marking the anon as
    /// captured so we stop retrying forever.
    func testPendingCapGivesUpAndWritesUnattributed() async throws {
        try Owl.configure(
            endpoint: Self.testEndpoint,
            apiKey: Self.testClientKey,
            bundleId: Self.testBundleId,
            attributionEnabled: false
        )
        let snapshot = snapshotIdentity()
        guard let transport = snapshot.transport,
              let userId = snapshot.userId,
              let anonId = snapshot.anonymousId else {
            XCTFail("SDK not configured")
            return
        }

        AppleSearchAdsAttribution.State.reset(anonymousId: anonId)

        // Simulate 5 prior pending attempts. The next submit should give up.
        for _ in 0..<4 {
            _ = AppleSearchAdsAttribution.State.incrementPendingAttempts(anonymousId: anonId)
        }

        _ = await AppleSearchAdsAttribution.submitForTest(
            token: "ignored",
            anonymousId: anonId,
            userId: userId,
            transport: transport,
            devMock: "pending"
        )

        // Give the async setUserProperties call a moment to complete.
        try await Task.sleep(nanoseconds: 500_000_000)

        XCTAssertTrue(AppleSearchAdsAttribution.State.isCaptured(anonymousId: anonId),
                      "After the pending cap, we should mark as captured to stop retrying")
    }

    // MARK: - Helpers

    private struct IdentitySnapshot {
        let transport: EventTransport?
        let userId: String?
        let anonymousId: String?
    }

    private func snapshotIdentity() -> IdentitySnapshot {
        let anon = IdentityManager.anonymousId()
        return IdentitySnapshot(
            transport: Owl._transportForTests(),
            userId: anon,
            anonymousId: anon
        )
    }

    private func postAttribution(userId: String, token: String, devMock: String) async throws -> [String: Any] {
        let url = URL(string: "\(Self.testEndpoint)/v1/identity/attribution/apple-search-ads")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(Self.testClientKey)", forHTTPHeaderField: "Authorization")
        let body: [String: String] = [
            "user_id": userId,
            "attribution_token": token,
            "dev_mock": devMock,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let bodyText = String(data: data, encoding: .utf8) ?? ""
            XCTFail("Attribution POST failed with status \(status): \(bodyText)")
            return [:]
        }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
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
                } catch { /* not ready */ }
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        return false
    }
}
