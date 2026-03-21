import {
  formatProjectsTable,
  formatProjectDetail,
  formatAppsTable,
  formatEventsTable,
  formatEventDetail,
  formatMetricEventsTable,
} from "../../formatters/table.js";
import { PROJECT, APP, EVENT, METRIC_EVENT, PROJECT_DETAIL, PROJECT_DETAIL_NO_APPS } from "../helpers/fixtures.js";

describe("formatProjectsTable", () => {
  it("produces output for empty list", () => {
    const result = formatProjectsTable([]);
    expect(typeof result).toBe("string");
  });

  it("contains project fields", () => {
    const result = formatProjectsTable([PROJECT]);
    expect(result).toContain(PROJECT.name);
    expect(result).toContain(PROJECT.slug);
    expect(result).toContain(PROJECT.id);
  });
});

describe("formatProjectDetail", () => {
  it("contains app names when apps exist", () => {
    const result = formatProjectDetail(PROJECT_DETAIL);
    expect(result).toContain(APP.name);
    expect(result).toContain(PROJECT.name);
  });

  it("shows 'No apps' when no apps", () => {
    const result = formatProjectDetail(PROJECT_DETAIL_NO_APPS);
    expect(result).toContain("No apps");
  });
});

describe("formatAppsTable", () => {
  it("contains app fields", () => {
    const result = formatAppsTable([APP]);
    expect(result).toContain(APP.name);
    expect(result).toContain(APP.platform);
    expect(result).toContain(APP.id);
  });
});

describe("formatEventsTable", () => {
  it("contains event data", () => {
    const result = formatEventsTable([EVENT]);
    expect(result).toContain(EVENT.level);
    expect(result).toContain(EVENT.timestamp);
  });

  it("truncates long messages", () => {
    const longEvent = { ...EVENT, message: "A".repeat(200) };
    const result = formatEventsTable([longEvent]);
    expect(result).not.toContain("A".repeat(200));
    expect(result).toContain("…");
  });
});

describe("formatEventDetail", () => {
  it("contains all metadata fields", () => {
    const result = formatEventDetail(EVENT);
    expect(result).toContain(EVENT.id);
    expect(result).toContain(EVENT.app_id);
    expect(result).toContain(EVENT.session_id);
    expect(result).toContain(EVENT.message);
    expect(result).toContain(EVENT.level);
    expect(result).toContain(EVENT.user_id!);
    expect(result).toContain(EVENT.screen_name!);
    expect(result).toContain(EVENT.environment!);
    expect(result).toContain(EVENT.os_version!);
    expect(result).toContain(EVENT.app_version!);
    expect(result).toContain(EVENT.device_model!);
  });

  it("shows custom attributes", () => {
    const result = formatEventDetail(EVENT);
    expect(result).toContain("build");
    expect(result).toContain("dev");
  });
});

describe("formatMetricEventsTable", () => {
  it("returns empty state message for no events", () => {
    const result = formatMetricEventsTable([]);
    expect(result).toContain("No metric events found");
  });

  it("contains metric event data", () => {
    const result = formatMetricEventsTable([METRIC_EVENT]);
    expect(result).toContain(METRIC_EVENT.phase);
    expect(result).toContain("1250ms");
  });
});
