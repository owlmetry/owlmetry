export interface IdentityClaimRequest {
  anonymous_id: string;
  user_id: string;
}

export interface IdentityClaimResponse {
  claimed: boolean;
  events_reassigned_count: number;
}

export const ANONYMOUS_ID_PREFIX = "owl_anon_";
