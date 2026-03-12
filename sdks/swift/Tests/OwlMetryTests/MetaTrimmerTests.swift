import XCTest
@testable import OwlMetry

final class MetaTrimmerTests: XCTestCase {
    func testNilReturnsNil() {
        XCTAssertNil(MetaTrimmer.trim(nil))
    }

    func testEmptyReturnsEmpty() {
        let result = MetaTrimmer.trim([:])
        XCTAssertEqual(result, [:])
    }

    func testShortValuesPassThrough() {
        let meta = ["key": "short value"]
        let result = MetaTrimmer.trim(meta)
        XCTAssertEqual(result, meta)
    }

    func testExactly200CharsPassThrough() {
        let value = String(repeating: "a", count: 200)
        let result = MetaTrimmer.trim(["key": value])
        XCTAssertEqual(result?["key"], value)
    }

    func testOver200CharsTrimmed() {
        let value = String(repeating: "a", count: 250)
        let result = MetaTrimmer.trim(["key": value])
        let expected = String(repeating: "a", count: 200) + " [TRIMMED 250]"
        XCTAssertEqual(result?["key"], expected)
    }

    func testMultipleKeysIndependent() {
        let short = "ok"
        let long = String(repeating: "b", count: 300)
        let result = MetaTrimmer.trim(["short": short, "long": long])
        XCTAssertEqual(result?["short"], short)
        XCTAssertTrue(result?["long"]?.contains("[TRIMMED 300]") == true)
    }
}
