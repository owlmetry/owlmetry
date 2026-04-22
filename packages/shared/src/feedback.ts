export type FeedbackStatus = "new" | "in_review" | "addressed" | "dismissed";

export const FEEDBACK_STATUSES = ["new", "in_review", "addressed", "dismissed"] as const;

export const MAX_FEEDBACK_MESSAGE_LENGTH = 4000;
export const MAX_FEEDBACK_NAME_LENGTH = 255;
export const MAX_FEEDBACK_EMAIL_LENGTH = 320;

// --- Ingest (SDK → server, synchronous) ---

export interface IngestFeedbackRequest {
  bundle_id: string;
  message: string;
  session_id?: string | null;
  user_id?: string | null;
  submitter_name?: string | null;
  submitter_email?: string | null;
  app_version?: string;
  environment?: string;
  device_model?: string;
  os_version?: string;
  is_dev?: boolean;
}

export interface IngestFeedbackResponse {
  id: string;
  created_at: string;
}

// --- Dashboard / CLI / MCP ---

export type FeedbackCommentAuthorType = "user" | "agent";

export interface FeedbackCommentResponse {
  id: string;
  feedback_id: string;
  author_type: FeedbackCommentAuthorType;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface FeedbackResponse {
  id: string;
  app_id: string;
  project_id: string;
  session_id: string | null;
  user_id: string | null;
  message: string;
  submitter_name: string | null;
  submitter_email: string | null;
  status: FeedbackStatus;
  is_dev: boolean;
  environment: string | null;
  os_version: string | null;
  app_version: string | null;
  device_model: string | null;
  country_code: string | null;
  created_at: string;
  updated_at: string;
  app_name?: string;
  project_name?: string;
  /**
   * The associated app_user's user_properties (RevenueCat subscription state,
   * ASA attribution, etc.). Null when the feedback has no user_id or the user
   * row can't be found. Undefined when the endpoint doesn't populate it.
   */
  user_properties?: Record<string, string> | null;
}

export interface FeedbackDetailResponse extends FeedbackResponse {
  comments: FeedbackCommentResponse[];
}

export interface FeedbackQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  status?: string;
  is_dev?: string;
  data_mode?: string;
  cursor?: string;
  limit?: string;
}

export interface FeedbackListResponse {
  feedback: FeedbackResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface UpdateFeedbackRequest {
  status?: FeedbackStatus;
}

export interface CreateFeedbackCommentRequest {
  body: string;
}

export interface UpdateFeedbackCommentRequest {
  body: string;
}

// Permissive per RFC 5322; strict enough to catch typos.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidFeedbackEmail(email: string): boolean {
  return email.length > 0 && email.length <= MAX_FEEDBACK_EMAIL_LENGTH && EMAIL_REGEX.test(email);
}
