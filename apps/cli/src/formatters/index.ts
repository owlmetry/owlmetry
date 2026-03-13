import { formatJson } from "./json.js";

export type OutputFormat = "table" | "json" | "log";

export function output(
  format: OutputFormat,
  data: unknown,
  tableFormatter: () => string,
  logFormatter?: () => string,
): void {
  switch (format) {
    case "json":
      console.log(formatJson(data));
      break;
    case "log":
      if (logFormatter) {
        console.log(logFormatter());
      } else {
        console.log(formatJson(data));
      }
      break;
    case "table":
    default:
      console.log(tableFormatter());
      break;
  }
}
