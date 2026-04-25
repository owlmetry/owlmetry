export type IssueStatus = "new" | "in_progress" | "resolved" | "silenced" | "regressed";
export type IssueAlertFrequency = "none" | "hourly" | "6_hourly" | "daily" | "weekly";

export const ISSUE_STATUSES = ["new", "in_progress", "resolved", "silenced", "regressed"] as const;
export const ISSUE_ALERT_FREQUENCIES = [
  "none", "hourly", "6_hourly", "daily", "weekly",
] as const;

// --- API Response Types ---

export interface IssueResponse {
  id: string;
  app_id: string;
  project_id: string;
  status: IssueStatus;
  title: string;
  source_module: string | null;
  is_dev: boolean;
  occurrence_count: number;
  unique_user_count: number;
  resolved_at_version: string | null;
  first_seen_app_version: string | null;
  last_seen_app_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
  fingerprints: string[];
  app_name?: string;
  project_name?: string;
}

export interface IssueOccurrenceResponse {
  id: string;
  issue_id: string;
  session_id: string;
  user_id: string | null;
  app_user_id: string | null;
  app_version: string | null;
  environment: string | null;
  event_id: string | null;
  country_code: string | null;
  timestamp: string;
  created_at: string;
}

export type IssueCommentAuthorType = "user" | "agent";

export interface IssueCommentResponse {
  id: string;
  issue_id: string;
  author_type: IssueCommentAuthorType;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface IssueAttachmentSummary {
  id: string;
  event_id: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string | null;
  created_at: string;
}

export interface IssueDetailResponse extends IssueResponse {
  occurrences: IssueOccurrenceResponse[];
  occurrence_cursor: string | null;
  occurrence_has_more: boolean;
  comments: IssueCommentResponse[];
  attachments: IssueAttachmentSummary[];
}

// --- API Request Types ---

export interface IssuesQueryParams {
  team_id?: string;
  project_id?: string;
  status?: string;
  app_id?: string;
  is_dev?: string;
  data_mode?: string;
  cursor?: string;
  limit?: string;
}

export interface IssuesResponse {
  issues: IssueResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface UpdateIssueRequest {
  status?: IssueStatus;
  resolved_at_version?: string;
}

export interface MergeIssuesRequest {
  source_issue_id: string;
}

export interface CreateIssueCommentRequest {
  body: string;
}

export interface UpdateIssueCommentRequest {
  body: string;
}

// --- Fingerprint Utilities ---

/**
 * Normalizes an error message for fingerprinting.
 * Strips variable parts: UUIDs, numbers, quoted strings.
 * Lowercases and collapses whitespace.
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
    .replace(/\b\d+(\.\d+)*\b/g, "<N>")
    .replace(/"[^"]*"/g, '"<S>"')
    .replace(/'[^']*'/g, "'<S>'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generates a SHA-256 fingerprint for an error.
 * Based on normalized message + source_module.
 */
export async function generateIssueFingerprint(
  message: string,
  sourceModule: string | null,
): Promise<string> {
  const normalized = normalizeErrorMessage(message);
  const input = `${sourceModule ?? ""}:${normalized}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
