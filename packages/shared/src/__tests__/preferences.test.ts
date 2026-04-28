import { describe, it, expect } from "vitest";
import {
  mergeUserPreferences,
  isDefaultColumnOrder,
  isChannelEnabled,
  NOTIFICATION_TYPE_META,
} from "../preferences.js";

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

describe("isChannelEnabled", () => {
  it("falls back to NOTIFICATION_TYPE_META defaults when prefs is null", () => {
    // issue.digest defaults: in_app + email + mobile_push all true.
    expect(isChannelEnabled(null, "issue.digest", "in_app")).toBe(true);
    expect(isChannelEnabled(null, "issue.digest", "email")).toBe(true);
    expect(isChannelEnabled(null, "issue.digest", "mobile_push")).toBe(true);
    // job.completed defaults: mobile_push false.
    expect(isChannelEnabled(null, "job.completed", "mobile_push")).toBe(false);
  });

  it("falls back to defaults when prefs has no notifications block", () => {
    const prefs = { ui: { columns: { events: { order: [] } } } };
    expect(isChannelEnabled(prefs, "feedback.new", "email")).toBe(true);
  });

  it("returns the user override when set", () => {
    const prefs = {
      notifications: { types: { "issue.digest": { email: false } } },
    };
    expect(isChannelEnabled(prefs, "issue.digest", "email")).toBe(false);
    // Channels not overridden still use defaults.
    expect(isChannelEnabled(prefs, "issue.digest", "in_app")).toBe(true);
    // Other types unaffected.
    expect(isChannelEnabled(prefs, "feedback.new", "email")).toBe(true);
  });

  it("treats explicit `true` as enabling even when default is false", () => {
    const prefs = {
      notifications: { types: { "job.completed": { mobile_push: true } } },
    };
    expect(isChannelEnabled(prefs, "job.completed", "mobile_push")).toBe(true);
  });

  it("returns false for team.invitation channels (transactional, no channels configured)", () => {
    expect(isChannelEnabled(null, "team.invitation", "email")).toBe(false);
    expect(isChannelEnabled(null, "team.invitation", "in_app")).toBe(false);
  });
});

describe("mergeUserPreferences with notifications", () => {
  it("merges new notification override into empty prefs", () => {
    const result = mergeUserPreferences(null, {
      notifications: { types: { "issue.digest": { email: false } } },
    });
    expect(result.notifications?.types?.["issue.digest"]?.email).toBe(false);
  });

  it("preserves other notification types when patching one type", () => {
    const existing = {
      notifications: {
        types: {
          "issue.digest": { email: false },
          "feedback.new": { mobile_push: false },
        },
      },
    };
    const result = mergeUserPreferences(existing, {
      notifications: { types: { "issue.digest": { in_app: true } } },
    });
    // The `feedback.new` override survives.
    expect(result.notifications?.types?.["feedback.new"]?.mobile_push).toBe(false);
    // The new `issue.digest.in_app` override is in place, and the existing
    // `issue.digest.email` override is preserved (channel maps merge per-key).
    expect(result.notifications?.types?.["issue.digest"]?.in_app).toBe(true);
    expect(result.notifications?.types?.["issue.digest"]?.email).toBe(false);
  });

  it("preserves sibling channel overrides when patching one channel within a type", () => {
    // Regression: a single-channel patch used to wipe other channel overrides
    // for the same type, which made the preferences page appear to auto-enable
    // mobile_push when in_app was unchecked (defaults snapped back).
    const existing = {
      notifications: {
        types: {
          "issue.new": { mobile_push: false },
        },
      },
    };
    const result = mergeUserPreferences(existing, {
      notifications: { types: { "issue.new": { in_app: false } } },
    });
    expect(result.notifications?.types?.["issue.new"]?.in_app).toBe(false);
    expect(result.notifications?.types?.["issue.new"]?.mobile_push).toBe(false);
  });

  it("preserves columns when patching notifications and vice-versa", () => {
    const existing = {
      ui: { columns: { events: { order: ["t", "l"] } } },
    };
    const result = mergeUserPreferences(existing, {
      notifications: { types: { "issue.digest": { email: false } } },
    });
    expect(result.ui?.columns?.events?.order).toEqual(["t", "l"]);
    expect(result.notifications?.types?.["issue.digest"]?.email).toBe(false);
  });
});

describe("NOTIFICATION_TYPE_META coverage", () => {
  it("every notification type has a meta entry", () => {
    for (const type of ["issue.digest", "feedback.new", "job.completed", "team.invitation"] as const) {
      expect(NOTIFICATION_TYPE_META[type]).toBeDefined();
      expect(NOTIFICATION_TYPE_META[type].label.length).toBeGreaterThan(0);
    }
  });

  it("transactional types declare no configurable channels", () => {
    expect(NOTIFICATION_TYPE_META["team.invitation"].channels).toEqual([]);
  });

  it("user-configurable types include in_app, email, and mobile_push", () => {
    for (const type of ["issue.digest", "feedback.new", "job.completed"] as const) {
      const channels = NOTIFICATION_TYPE_META[type].channels;
      expect(channels).toContain("in_app");
      expect(channels).toContain("email");
      expect(channels).toContain("mobile_push");
    }
  });
});
