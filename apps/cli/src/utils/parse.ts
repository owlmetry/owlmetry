export function parsePositiveInt(value: string, flagName: string): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return n;
}
