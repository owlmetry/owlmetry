import XCTest
@testable import OwlMetry

final class CustomAttributeTrimmerTests: XCTestCase {
    func testNilReturnsNil() {
        XCTAssertNil(CustomAttributeTrimmer.trim(nil))
    }

    func testEmptyReturnsEmpty() {
        let result = CustomAttributeTrimmer.trim([:])
        XCTAssertEqual(result, [:])
    }

    func testShortValuesPassThrough() {
        let attributes = ["key": "short value"]
        let result = CustomAttributeTrimmer.trim(attributes)
        XCTAssertEqual(result, attributes)
    }

    func testExactly200CharsPassThrough() {
        let value = String(repeating: "a", count: 200)
        let result = CustomAttributeTrimmer.trim(["key": value])
        XCTAssertEqual(result?["key"], value)
    }

    func testOver200CharsTrimmed() {
        let value = String(repeating: "a", count: 250)
        let result = CustomAttributeTrimmer.trim(["key": value])
        let expected = String(repeating: "a", count: 200) + " [TRIMMED 250]"
        XCTAssertEqual(result?["key"], expected)
    }

    func testMultipleKeysIndependent() {
        let short = "ok"
        let long = String(repeating: "b", count: 300)
        let result = CustomAttributeTrimmer.trim(["short": short, "long": long])
        XCTAssertEqual(result?["short"], short)
        XCTAssertTrue(result?["long"]?.contains("[TRIMMED 300]") == true)
    }
}
