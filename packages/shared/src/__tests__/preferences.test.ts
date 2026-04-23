import { describe, it, expect } from "vitest";
import { mergeUserPreferences, isDefaultColumnOrder } from "../preferences.js";

describe("mergeUserPreferences", () => {
  it("returns patch when existing is null", () => {
    const result = mergeUserPreferences(null, {
      ui: { columns: { events: { order: ["a", "b"] } } },
    });
    expect(result).toEqual({
      ui: { columns: { events: { order: ["a", "b"] } } },
    });
  });

  it("treats undefined existing the same as null", () => {
    const result = mergeUserPreferences(undefined, { version: 1 });
    expect(result).toEqual({ version: 1 });
  });

  it("preserves existing sub-objects when patch touches a different one", () => {
    const existing = {
      ui: { columns: { events: { order: ["t", "l"] } } },
    };
    const result = mergeUserPreferences(existing, {
      ui: { columns: { users: { order: ["u", "c"] } } },
    });
    expect(result).toEqual({
      ui: {
        columns: {
          events: { order: ["t", "l"] },
          users: { order: ["u", "c"] },
        },
      },
    });
  });

  it("deep-replaces a sub-object the patch provides", () => {
    const existing = {
      ui: { columns: { events: { order: ["a", "b", "c"] } } },
    };
    const result = mergeUserPreferences(existing, {
      ui: { columns: { events: { order: ["c"] } } },
    });
    expect(result.ui?.columns?.events?.order).toEqual(["c"]);
  });

  it("overwrites version when provided", () => {
    const result = mergeUserPreferences({ version: 1 }, { version: 1 });
    expect(result.version).toBe(1);
  });

  it("leaves existing untouched when patch is empty", () => {
    const existing = {
      ui: { columns: { events: { order: ["a"] } } },
    };
    const result = mergeUserPreferences(existing, {});
    expect(result).toEqual(existing);
  });

  it("does not mutate the existing object", () => {
    const existing = {
      ui: { columns: { events: { order: ["a"] } } },
    };
    const snapshot = JSON.parse(JSON.stringify(existing));
    mergeUserPreferences(existing, {
      ui: { columns: { users: { order: ["u"] } } },
    });
    expect(existing).toEqual(snapshot);
  });
});

describe("isDefaultColumnOrder", () => {
  it("returns true for identical arrays", () => {
    expect(isDefaultColumnOrder(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("returns false when lengths differ", () => {
    expect(isDefaultColumnOrder(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(isDefaultColumnOrder(["a", "b", "c"], ["a", "b"])).toBe(false);
  });

  it("returns false when an element differs", () => {
    expect(isDefaultColumnOrder(["a", "c", "b"], ["a", "b", "c"])).toBe(false);
  });

  it("treats two empty arrays as equal", () => {
    expect(isDefaultColumnOrder([], [])).toBe(true);
  });
});
