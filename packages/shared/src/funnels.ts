export interface FunnelStep {
  name: string;
  event_message: string;
  event_screen_name?: string;
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
  drop_off_count: number;
}

export interface FunnelAnalytics {
  funnel: FunnelDefinition;
  total_users: number;
  steps: FunnelStepAnalytics[];
}
