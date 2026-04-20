export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function timeAgoOrDate(
  dateStr: string,
  fallback: (date: string) => string,
): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff >= WEEK_MS) return fallback(dateStr);
  return timeAgo(dateStr);
}
