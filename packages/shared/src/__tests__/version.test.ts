import { describe, it, expect } from "vitest";
import { compareToLatest, compareVersions } from "../version.js";

describe("compareVersions", () => {
  it("treats equal strings as equal", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("orders standard semver", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  });

  it("handles 1.10 > 1.9 numerically (not lexicographically)", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("1.10", "1.9")).toBe(1);
  });

  it("strips leading v", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("V1.2.3", "v1.2.4")).toBe(-1);
  });

  it("strips parenthesised build numbers", () => {
    expect(compareVersions("1.2.3 (456)", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3 (1000)", "1.2.4")).toBe(-1);
  });

  it("treats missing trailing segments as 0", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.1")).toBe(-1);
    expect(compareVersions("2", "1.99.99")).toBe(1);
  });

  it("orders pre-releases below their base release (semver §11)", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(1);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0-rc.1")).toBe(-1);
    expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
  });

  it("handles date-style versions", () => {
    expect(compareVersions("2024.10.15", "2024.10.16")).toBe(-1);
    expect(compareVersions("2025.01.01", "2024.12.31")).toBe(1);
  });
});

describe("compareToLatest", () => {
  it("returns 0 when equal", () => {
    expect(compareToLatest("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns -1 when version is older", () => {
    expect(compareToLatest("1.2.2", "1.2.3")).toBe(-1);
  });

  it("returns 1 when version is newer than latest (TestFlight or stale latest detection)", () => {
    expect(compareToLatest("1.2.4", "1.2.3")).toBe(1);
  });

  it("returns null when either input is null", () => {
    expect(compareToLatest(null, "1.2.3")).toBe(null);
    expect(compareToLatest("1.2.3", null)).toBe(null);
    expect(compareToLatest(null, null)).toBe(null);
  });
});
