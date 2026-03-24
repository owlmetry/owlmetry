import XCTest
@testable import OwlMetry

final class OwlIntegrationTests: XCTestCase {
    func testEventsDroppedBeforeConfigure() {
        // Should not crash
        Owl.info("this should be silently dropped")
        Owl.error("this too")
        Owl.recordMetric("also.this")
    }

    func testConfigurationRejectsAgentKey() {
        XCTAssertThrowsError(try OwlConfiguration(endpoint: "https://api.test.com", apiKey: "owl_agent_abc")) { error in
            XCTAssertTrue(error.localizedDescription.contains("owl_client_"))
        }
    }

    func testConfigurationRejectsInvalidEndpoint() {
        XCTAssertThrowsError(try OwlConfiguration(endpoint: "", apiKey: "owl_client_abc"))
    }

    func testConfigurationAcceptsValidInput() {
        XCTAssertNoThrow(try OwlConfiguration(endpoint: "https://api.example.com", apiKey: "owl_client_test123"))
    }
}
