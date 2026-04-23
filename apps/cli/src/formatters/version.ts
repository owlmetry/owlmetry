import chalk from "chalk";
import { isLatestVersion } from "@owlmetry/shared/version";

export function formatVersion(
  version: string | null | undefined,
  latest: string | null | undefined,
): string {
  if (!version) return "";
  const result = isLatestVersion(version, latest ?? null);
  if (result === true) return chalk.green(version);
  if (result === false) return chalk.yellow(version);
  return version;
}
