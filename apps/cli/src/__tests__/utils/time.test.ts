import { parseTimeInput } from "../../utils/time.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-06-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseTimeInput", () => {
  it("parses '1h' as 1 hour ago", () => {
    const result = parseTimeInput("1h");
    expect(result).toBe(new Date("2025-06-15T11:00:00.000Z").toISOString());
  });

  it("parses '30m' as 30 minutes ago", () => {
    const result = parseTimeInput("30m");
    expect(result).toBe(new Date("2025-06-15T11:30:00.000Z").toISOString());
  });

  it("parses '7d' as 7 days ago", () => {
    const result = parseTimeInput("7d");
    expect(result).toBe(new Date("2025-06-08T12:00:00.000Z").toISOString());
  });

  it("parses '1w' as 1 week ago", () => {
    const result = parseTimeInput("1w");
    expect(result).toBe(new Date("2025-06-08T12:00:00.000Z").toISOString());
  });

  it("parses '30s' as 30 seconds ago", () => {
    const result = parseTimeInput("30s");
    expect(result).toBe(new Date("2025-06-15T11:59:30.000Z").toISOString());
  });

  it("passes through valid ISO 8601 dates", () => {
    const iso = "2025-01-01T00:00:00.000Z";
    expect(parseTimeInput(iso)).toBe(iso);
  });

  it("passes through non-ISO parseable dates", () => {
    const result = parseTimeInput("2025-01-15");
    expect(result).toContain("2025-01-15");
  });

  it("throws on invalid input", () => {
    expect(() => parseTimeInput("garbage")).toThrow(/Invalid time input/);
    expect(() => parseTimeInput("garbage")).toThrow(/"garbage"/);
  });
});
