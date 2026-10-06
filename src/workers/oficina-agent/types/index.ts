export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'session_expired' | 'timeout' | 'cancelled' | 'partial';
export type JobAction = 'get_revenue' | 'get_os' | 'audit_os' | 'compare_supabase' | 'map_domain' | 'map_header' | 'map_screens' | 'generate_workflows' | 'execute_workflow';

export interface JobParams {
  date_from?: string; // YYYY-MM-DD
  date_to?: string;   // YYYY-MM-DD
  unit?: string | null;
  os_number?: string | null;
  seed_urls?: string[];
  max_depth?: number;
  max_pages?: number;
  resume?: boolean;
  use_header_seeds?: boolean;
  domains?: string[];
}

export interface JobRequest {
  action: JobAction;
  params: JobParams;
  callback_url?: string | null;
  request_id?: string;
}

export interface JobEvidence {
  screenshot_path?: string;
  download_path?: string | null;
  trace_path?: string | null;
}

export interface JobError {
  code: string | null;
  message: string | null;
  step: string | null;
}

export interface JobMeta {
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  session?: 'valid' | 'expired' | 'unknown';
  data_freshness?: string | null;
}

export interface JobResponse {
  job_id: string;
  request_id?: string;
  status: JobStatus;
  action: JobAction;
  source: 'oficina_ui' | 'supabase' | 'combined';
  result: any;
  meta: JobMeta;
  evidence: JobEvidence;
  error?: JobError;
}

export interface JobEntry {
  id: string;
  request: JobRequest;
  status: JobStatus;
  createdAt: number;
  response?: JobResponse;
  timeoutId?: NodeJS.Timeout;
}
