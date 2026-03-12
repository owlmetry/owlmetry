export interface ClaimRequest {
  anonymous_id: string;
  user_id: string;
}

export interface ClaimResponse {
  claimed: boolean;
  events_updated: number;
}

export const ANONYMOUS_ID_PREFIX = "owl_anon_";
