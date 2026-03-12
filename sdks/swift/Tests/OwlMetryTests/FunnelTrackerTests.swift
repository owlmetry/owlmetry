import XCTest
@testable import OwlMetry

final class FunnelTrackerTests: XCTestCase {
    private var defaults: UserDefaults!

    override func setUp() {
        defaults = UserDefaults(suiteName: "com.owlmetry.test.\(UUID().uuidString)")!
    }

    override func tearDown() {
        if let suiteName = defaults.volatileDomainNames.first {
            UserDefaults.standard.removePersistentDomain(forName: suiteName)
        }
        defaults = nil
    }

    func testHasTrackedOnceReturnsFalseInitially() {
        XCTAssertFalse(FunnelTracker.hasTrackedOnce("onboarding.start", defaults: defaults))
    }

    func testMarkTrackedOncePersists() {
        FunnelTracker.markTrackedOnce("onboarding.start", defaults: defaults)
        XCTAssertTrue(FunnelTracker.hasTrackedOnce("onboarding.start", defaults: defaults))
    }

    func testDifferentNamesAreIndependent() {
        FunnelTracker.markTrackedOnce("event_a", defaults: defaults)
        XCTAssertTrue(FunnelTracker.hasTrackedOnce("event_a", defaults: defaults))
        XCTAssertFalse(FunnelTracker.hasTrackedOnce("event_b", defaults: defaults))
    }
}
