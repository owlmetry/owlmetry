import { describe, it, expect } from "vitest";
import { truncateCustomAttributes } from "../event-processing.js";
import { MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH } from "@owlmetry/shared";

describe("truncateCustomAttributes", () => {
  it("returns null for undefined input", () => {
    expect(truncateCustomAttributes(undefined)).toBeNull();
  });

  it("truncates ordinary attribute values to MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH", () => {
    const long = "x".repeat(MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH * 2);
    const out = truncateCustomAttributes({ foo: long });
    expect(out!.foo).toHaveLength(MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH);
  });

  it("preserves _error_stack values up to the override cap (16000)", () => {
    const stack = "x".repeat(8000);
    const out = truncateCustomAttributes({ _error_stack: stack });
    expect(out!._error_stack).toHaveLength(8000);
  });

  it("truncates _error_stack at the 16000 cap", () => {
    const stack = "x".repeat(20000);
    const out = truncateCustomAttributes({ _error_stack: stack });
    expect(out!._error_stack).toHaveLength(16000);
  });

  it("keeps _error_type at the default 200-char cap (no override)", () => {
    const t = "T".repeat(500);
    const out = truncateCustomAttributes({ _error_type: t });
    expect(out!._error_type).toHaveLength(MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH);
  });

  it("preserves short values verbatim", () => {
    const out = truncateCustomAttributes({ a: "short", b: "" });
    expect(out).toEqual({ a: "short", b: "" });
  });
});
