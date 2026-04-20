// Event Attachments — API shapes shared between server, SDKs, CLI, MCP, and web.
//
// Flow:
//   1. Client POSTs /ingest/attachment with metadata → server validates quota/size/type,
//      creates a row, returns { attachment_id, upload_url }.
//   2. Client PUTs raw bytes to upload_url → server streams to disk, verifies size + sha256,
//      sets uploaded_at. Until then the row exists but is not considered "complete".
//
// Attachments are linked to events via client_event_id (SDK-generated UUID). The server
// backfills event_id when the corresponding event arrives. The issue-scan job later links
// attachments to issues via issue_id so they survive event retention pruning.

export interface AttachmentUploadRequest {
  client_event_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  is_dev?: boolean;
}

export interface AttachmentUploadResponse {
  attachment_id: string;
  upload_url: string;
  expires_at: string;
}

export type AttachmentRejectionCode =
  | "quota_exhausted"
  | "file_too_large"
  | "disallowed_content_type"
  | "invalid_request"
  | "size_mismatch"
  | "hash_mismatch"
  | "already_uploaded";

export interface AttachmentRejection {
  code: AttachmentRejectionCode;
  message: string;
  quota_bytes?: number;
  used_bytes?: number;
  max_file_bytes?: number;
}

export interface AttachmentSummary {
  id: string;
  project_id: string;
  app_id: string;
  event_client_id: string | null;
  event_id: string | null;
  issue_id: string | null;
  user_id: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  is_dev: boolean;
  uploaded_at: string | null;
  created_at: string;
}

export interface AttachmentListResponse {
  attachments: AttachmentSummary[];
  cursor: string | null;
  has_more: boolean;
}

export interface AttachmentQuotaUsage {
  project_id: string;
  used_bytes: number;
  quota_bytes: number;
  max_file_bytes: number;
  file_count: number;
}

export interface AttachmentDownloadUrlResponse {
  url: string;
  expires_at: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
}
