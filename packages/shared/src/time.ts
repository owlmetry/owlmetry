const RELATIVE_PATTERN = /^(\d+)([smhdw])$/;

const MULTIPLIERS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parse a time parameter that can be either a relative duration (e.g. "1h", "30m", "7d")
 * or an absolute date (ISO 8601 or parseable date string). Returns a Date object.
 */
export function parseTimeParam(input: string): Date {
  const match = input.match(RELATIVE_PATTERN);
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const ms = amount * MULTIPLIERS[unit];
    return new Date(Date.now() - ms);
  }

  const date = new Date(input);
  if (isNaN(date.getTime())) {
    throw new Error(
      `Invalid time input: "${input}". Use relative (e.g. 1h, 30m, 7d) or ISO 8601 format.`,
    );
  }
  return date;
}
