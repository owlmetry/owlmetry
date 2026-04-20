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
