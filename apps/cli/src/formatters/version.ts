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

/** Renders an SDK identity pair as `"<name> <version>"`, or an empty string
 * if both inputs are missing. Callers handle the empty case (typically as `"—"`). */
export function formatSdkLabel(
  name: string | null | undefined,
  version: string | null | undefined,
): string {
  return [name, version].filter(Boolean).join(" ");
}
