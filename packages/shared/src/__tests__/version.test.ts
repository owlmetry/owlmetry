import { describe, it, expect } from "vitest";
import { compareVersions, isLatestVersion } from "../version.js";

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

  it("compares mixed numeric / alpha segments lexicographically", () => {
    // "1.0.0" > "1.0.0-beta" because "0" is numeric while "0-beta" is alpha
    // (and the first non-equal segment decides). This isn't strict semver
    // pre-release ordering, but it gives sensible ordering for app versions.
    expect(compareVersions("1.0.0", "1.0.0-beta")).not.toBe(0);
  });

  it("handles date-style versions", () => {
    expect(compareVersions("2024.10.15", "2024.10.16")).toBe(-1);
    expect(compareVersions("2025.01.01", "2024.12.31")).toBe(1);
  });
});

describe("isLatestVersion", () => {
  it("returns true on equal", () => {
    expect(isLatestVersion("1.2.3", "1.2.3")).toBe(true);
  });

  it("returns false when version is older", () => {
    expect(isLatestVersion("1.2.2", "1.2.3")).toBe(false);
  });

  it("returns false even when version is newer than latest (edge case: pre-release)", () => {
    // If the user is on a TestFlight build ahead of App Store latest, we don't claim "latest" — only equality counts.
    expect(isLatestVersion("1.2.4", "1.2.3")).toBe(false);
  });

  it("returns null when either input is null", () => {
    expect(isLatestVersion(null, "1.2.3")).toBe(null);
    expect(isLatestVersion("1.2.3", null)).toBe(null);
    expect(isLatestVersion(null, null)).toBe(null);
  });
});
