import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseTimeParam } from "@owlmetry/shared";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-06-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseTimeParam", () => {
  it("parses '1h' as 1 hour ago", () => {
    expect(parseTimeParam("1h")).toEqual(new Date("2025-06-15T11:00:00.000Z"));
  });

  it("parses '30m' as 30 minutes ago", () => {
    expect(parseTimeParam("30m")).toEqual(new Date("2025-06-15T11:30:00.000Z"));
  });

  it("parses '7d' as 7 days ago", () => {
    expect(parseTimeParam("7d")).toEqual(new Date("2025-06-08T12:00:00.000Z"));
  });

  it("parses '1w' as 1 week ago", () => {
    expect(parseTimeParam("1w")).toEqual(new Date("2025-06-08T12:00:00.000Z"));
  });

  it("parses '30s' as 30 seconds ago", () => {
    expect(parseTimeParam("30s")).toEqual(new Date("2025-06-15T11:59:30.000Z"));
  });

  it("parses ISO 8601 strings", () => {
    const iso = "2025-01-01T00:00:00.000Z";
    expect(parseTimeParam(iso)).toEqual(new Date(iso));
  });

  it("parses date-only strings", () => {
    const result = parseTimeParam("2025-01-15");
    expect(result.toISOString()).toContain("2025-01-15");
  });

  it("throws on invalid input", () => {
    expect(() => parseTimeParam("garbage")).toThrow(/Invalid time input/);
    expect(() => parseTimeParam("garbage")).toThrow(/"garbage"/);
  });
});
