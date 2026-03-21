import { formatEventLog, formatEventsLog, formatMetricEventsLog } from "../../formatters/log.js";
import { EVENT, METRIC_EVENT } from "../helpers/fixtures.js";

describe("formatEventLog", () => {
  it("contains timestamp, level, and message", () => {
    const result = formatEventLog(EVENT);
    expect(result).toContain(EVENT.message);
    expect(result).toContain("INFO");
  });

  it("includes user and session metadata", () => {
    const result = formatEventLog(EVENT);
    expect(result).toContain("user=user-123");
    expect(result).toContain("session=");
  });
});

describe("formatEventsLog", () => {
  it("highlights event when highlightId matches", () => {
    const result = formatEventsLog([EVENT], { highlightId: EVENT.id });
    expect(result).toContain(">>>");
  });

  it("does not highlight non-matching events", () => {
    const result = formatEventsLog([EVENT], { highlightId: "other-id" });
    expect(result).not.toContain(">>>");
  });
});

describe("formatMetricEventsLog", () => {
  it("returns empty state message for no events", () => {
    const result = formatMetricEventsLog([], "app-launch");
    expect(result).toContain("No metric events found");
  });

  it("contains metric slug and phase", () => {
    const result = formatMetricEventsLog([METRIC_EVENT], "app-launch");
    expect(result).toContain("COMPLETE");
    expect(result).toContain("app-launch");
  });
});
