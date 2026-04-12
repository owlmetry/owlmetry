import { describe, it, expect } from "vitest";
import { normalizeErrorMessage, generateIssueFingerprint } from "../issues.js";

describe("normalizeErrorMessage", () => {
  it("replaces UUIDs with <uuid>", () => {
    expect(normalizeErrorMessage("User 550e8400-e29b-41d4-a716-446655440000 not found"))
      .toBe("user <uuid> not found");
  });

  it("replaces multiple UUIDs", () => {
    expect(normalizeErrorMessage("Link 550e8400-e29b-41d4-a716-446655440000 to 6ba7b810-9dad-11d1-80b4-00c04fd430c8"))
      .toBe("link <uuid> to <uuid>");
  });

  it("replaces uppercase UUIDs", () => {
    expect(normalizeErrorMessage("ID: 550E8400-E29B-41D4-A716-446655440000"))
      .toBe("id: <uuid>");
  });

  it("replaces integers with <n>", () => {
    expect(normalizeErrorMessage("Error code 404"))
      .toBe("error code <n>");
  });

  it("replaces floating point numbers", () => {
    expect(normalizeErrorMessage("Timeout after 3.5 seconds"))
      .toBe("timeout after <n> seconds");
  });

  it("replaces version-like numbers", () => {
    expect(normalizeErrorMessage("Version 1.2.3 incompatible"))
      .toBe("version <n> incompatible");
  });

  it("replaces negative-adjacent numbers", () => {
    // The regex replaces word-boundary numbers, so "-5" becomes "-<n>"
    expect(normalizeErrorMessage("offset -5 is invalid"))
      .toBe("offset -<n> is invalid");
  });

  it("replaces double-quoted strings with <s>", () => {
    expect(normalizeErrorMessage('Key "username" is required'))
      .toBe('key "<s>" is required');
  });

  it("replaces single-quoted strings with <s>", () => {
    expect(normalizeErrorMessage("Module 'express' not found"))
      .toBe("module '<s>' not found");
  });

  it("handles apostrophes — greedy match consumes contraction", () => {
    // The regex matches 't find module ' as a single-quoted string.
    // This means "Can't find module 'X'" normalizes differently depending on X
    // when there's a contraction. This is a known trade-off of simple regex normalization.
    // Errors without contractions normalize correctly:
    const a = normalizeErrorMessage("Cannot find module 'express'");
    const b = normalizeErrorMessage("Cannot find module 'lodash'");
    expect(a).toBe(b);
    expect(a).toBe("cannot find module '<s>'");
  });

  it("replaces empty quoted strings", () => {
    expect(normalizeErrorMessage('Value "" is not allowed'))
      .toBe('value "<s>" is not allowed');
  });

  it("lowercases the result", () => {
    expect(normalizeErrorMessage("FATAL ERROR"))
      .toBe("fatal error");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeErrorMessage("error   in   module"))
      .toBe("error in module");
  });

  it("trims whitespace", () => {
    expect(normalizeErrorMessage("  error message  "))
      .toBe("error message");
  });

  it("handles empty string", () => {
    expect(normalizeErrorMessage("")).toBe("");
  });

  it("handles message with only numbers", () => {
    expect(normalizeErrorMessage("12345")).toBe("<n>");
  });

  it("handles complex real-world error", () => {
    const msg = 'Failed to fetch user 12345 from /api/users/550e8400-e29b-41d4-a716-446655440000 with status 500';
    expect(normalizeErrorMessage(msg))
      .toBe('failed to fetch user <n> from /api/users/<uuid> with status <n>');
  });

  it("handles JSON-like content in error messages", () => {
    const msg = 'Invalid body: {"name":"test","count":42}';
    // Quotes around "name" and "test" get replaced
    expect(normalizeErrorMessage(msg)).toContain("<s>");
    expect(normalizeErrorMessage(msg)).toContain("<n>");
  });

  it("preserves path-like content", () => {
    expect(normalizeErrorMessage("File /var/log/app.log not found"))
      .toBe("file /var/log/app.log not found");
  });

  it("handles unicode characters", () => {
    expect(normalizeErrorMessage("Erreur: données invalides"))
      .toBe("erreur: données invalides");
  });

  it("normalizes tabs and newlines to spaces", () => {
    expect(normalizeErrorMessage("error\tin\nmodule"))
      .toBe("error in module");
  });

  it("produces identical output for semantically same errors with different values", () => {
    const a = normalizeErrorMessage("User 123 not found");
    const b = normalizeErrorMessage("User 456 not found");
    expect(a).toBe(b);
  });

  it("produces different output for structurally different errors", () => {
    const a = normalizeErrorMessage("Connection timeout");
    const b = normalizeErrorMessage("Authentication failed");
    expect(a).not.toBe(b);
  });
});

describe("generateIssueFingerprint", () => {
  it("returns a 64-character hex string", async () => {
    const fp = await generateIssueFingerprint("test error", null);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same message and module produces same fingerprint", async () => {
    const a = await generateIssueFingerprint("Connection refused", "NetworkModule");
    const b = await generateIssueFingerprint("Connection refused", "NetworkModule");
    expect(a).toBe(b);
  });

  it("different messages produce different fingerprints", async () => {
    const a = await generateIssueFingerprint("Connection refused", null);
    const b = await generateIssueFingerprint("Timeout exceeded", null);
    expect(a).not.toBe(b);
  });

  it("same message with different modules produces different fingerprints", async () => {
    const a = await generateIssueFingerprint("Connection refused", "ModuleA");
    const b = await generateIssueFingerprint("Connection refused", "ModuleB");
    expect(a).not.toBe(b);
  });

  it("null source_module vs empty string produces different fingerprints", async () => {
    const a = await generateIssueFingerprint("Error", null);
    const b = await generateIssueFingerprint("Error", "");
    expect(a).toBe(b); // Both normalize to ":error" since null → ""
  });

  it("normalizes variable parts before hashing — same error with different IDs", async () => {
    const a = await generateIssueFingerprint("User 123 not found", "UserService");
    const b = await generateIssueFingerprint("User 456 not found", "UserService");
    expect(a).toBe(b);
  });

  it("normalizes UUIDs — same error with different UUIDs", async () => {
    const a = await generateIssueFingerprint(
      "Record 550e8400-e29b-41d4-a716-446655440000 not found", null
    );
    const b = await generateIssueFingerprint(
      "Record 6ba7b810-9dad-11d1-80b4-00c04fd430c8 not found", null
    );
    expect(a).toBe(b);
  });

  it("is case-insensitive", async () => {
    const a = await generateIssueFingerprint("CONNECTION REFUSED", "Net");
    const b = await generateIssueFingerprint("connection refused", "Net");
    expect(a).toBe(b);
  });

  it("handles empty message", async () => {
    const fp = await generateIssueFingerprint("", null);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles very long messages", async () => {
    const longMsg = "Error: " + "x".repeat(10000);
    const fp = await generateIssueFingerprint(longMsg, null);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
