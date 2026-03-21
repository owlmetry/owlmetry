import { truncate } from "../../utils/truncate.js";

describe("truncate", () => {
  it("does not truncate text within limit", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("returns text unchanged at exact boundary", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });

  it("truncates with ellipsis when over limit", () => {
    const result = truncate("this is a long message", 10);
    expect(result).toHaveLength(10);
    expect(result).toBe("this is a…");
  });

  it("handles empty string", () => {
    expect(truncate("", 10)).toBe("");
  });

  it("handles single character limit", () => {
    expect(truncate("abc", 1)).toBe("…");
  });
});
