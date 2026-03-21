import { parsePositiveInt } from "../../utils/parse.js";

describe("parsePositiveInt", () => {
  it("parses valid positive integers", () => {
    expect(parsePositiveInt("5", "--limit")).toBe(5);
    expect(parsePositiveInt("1", "--limit")).toBe(1);
    expect(parsePositiveInt("100", "--limit")).toBe(100);
  });

  it("throws on zero", () => {
    expect(() => parsePositiveInt("0", "--limit")).toThrow("--limit must be a positive integer");
  });

  it("throws on negative numbers", () => {
    expect(() => parsePositiveInt("-1", "--limit")).toThrow("--limit must be a positive integer");
  });

  it("throws on non-numeric strings", () => {
    expect(() => parsePositiveInt("abc", "--limit")).toThrow("--limit must be a positive integer");
  });

  it("includes flag name in error message", () => {
    expect(() => parsePositiveInt("abc", "--page-size")).toThrow("--page-size");
  });
});
