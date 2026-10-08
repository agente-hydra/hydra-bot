import { Page } from 'playwright';

export interface WorkflowFreshness {
    last_sync_at: string;
    is_current_enough: boolean;
}

export type WorkflowStatus = 'success' | 'partial' | 'failed' | 'needs_clarification';

export interface WorkflowMeta {
    duration_ms?: number;
    source_session?: string;
    executor?: string;
    reason?: string;
}

export interface WorkflowResult {
    status: WorkflowStatus;
    workflow_id: string;
    source: 'supabase' | 'oficina_ui_export';
    params: any;
    result: any;
    evidence: any;
    meta: WorkflowMeta;
    freshness?: WorkflowFreshness;
}

export type BusinessOperator = (page: Page, params: any) => Promise<WorkflowResult>;
