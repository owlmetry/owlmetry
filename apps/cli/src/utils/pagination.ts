import chalk from "chalk";

export function paginationHint(result: { has_more: boolean; cursor: string | null }): string {
  if (result.has_more && result.cursor) {
    return `\n${chalk.dim(`More results available. Use --cursor ${result.cursor}`)}`;
  }
  return "";
}
