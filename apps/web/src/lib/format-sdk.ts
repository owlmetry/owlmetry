export function formatSdkLabel(
  name: string | null | undefined,
  version: string | null | undefined,
): string {
  return [name, version].filter(Boolean).join(" ");
}
