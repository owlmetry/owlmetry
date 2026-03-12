export interface FunnelStep {
  name: string;
  event_body: string;
  event_context?: string;
}

export interface FunnelDefinition {
  id: string;
  app_id: string;
  name: string;
  steps: FunnelStep[];
  created_at: Date;
}

export interface FunnelStepAnalytics {
  step_index: number;
  step_name: string;
  count: number;
  percentage: number;
  drop_off: number;
}

export interface FunnelAnalytics {
  funnel: FunnelDefinition;
  total_users: number;
  steps: FunnelStepAnalytics[];
}
