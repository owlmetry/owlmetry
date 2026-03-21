import { paginationHint } from "../../utils/pagination.js";

describe("paginationHint", () => {
  it("returns hint with cursor when more results available", () => {
    const hint = paginationHint({ has_more: true, cursor: "abc123" });
    expect(hint).toContain("--cursor");
    expect(hint).toContain("abc123");
  });

  it("returns empty string when no more results", () => {
    expect(paginationHint({ has_more: false, cursor: null })).toBe("");
  });

  it("returns empty string when has_more but no cursor", () => {
    expect(paginationHint({ has_more: true, cursor: null })).toBe("");
  });
});
