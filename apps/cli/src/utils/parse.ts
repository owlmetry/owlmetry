import fs from "node:fs";

export function parsePositiveInt(value: string, flagName: string): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return n;
}

/**
 * Resolves a JSON array from either an inline string or a file path.
 * Returns the parsed array, or an error message string on failure.
 */
export function resolveJsonArray(
  inline: string | undefined,
  filePath: string | undefined,
  opts: { required: boolean },
): unknown[] | string {
  if (inline && filePath) {
    return "Error: --steps and --steps-file are mutually exclusive";
  }
  if (!inline && !filePath) {
    return opts.required
      ? "Error: either --steps or --steps-file is required"
      : ""; // empty string = no steps provided, not an error
  }

  let json: string;
  if (filePath) {
    try {
      json = fs.readFileSync(filePath, "utf-8");
    } catch (err: any) {
      return `Error reading --steps-file: ${err.message}`;
    }
  } else {
    json = inline!;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return "Error: steps must be valid JSON";
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return "Error: steps must be a non-empty JSON array";
  }

  return parsed;
}
