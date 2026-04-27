import chalk from "chalk";

// Render a 1-5 star rating as colored unicode stars. Rounds non-integer values
// to the nearest whole star so callers don't need to.
export function stars(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return chalk.yellow("★".repeat(full)) + chalk.gray("★".repeat(5 - full));
}
