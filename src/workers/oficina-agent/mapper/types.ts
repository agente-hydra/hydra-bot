export interface ActionInfo {
  label: string;
  type: 'export' | 'postback' | 'navigation' | 'unknown';
  format?: string;
  target?: string;
  requires_human_review?: boolean;
}

export interface FilterInfo {
  name: string;
  type: 'text' | 'date' | 'select' | 'checkbox' | 'unknown';
  options_sample?: string[];
}

export interface PageNode {
  url: string;
  postback_target?: string | null;
  title: string;
  breadcrumb: string[];
  filters: FilterInfo[];
  table_columns: string[];
  actions: ActionInfo[];
  links_discovered: string[]; // Apenas links comuns (href limpo)
  postbacks_discovered: string[]; // Elementos que disparam postback que não são paginação
  pagination_detected?: boolean;
  sortable_columns?: string[];
  snapshot_ref: string;
  screenshot_ref: string;
  confidence: 'discovered' | 'validated' | 'requires_human_review';
}

export interface AppMap {
  domain: string;
  generated_at: string;
  pages: PageNode[];
}

export interface CrawlerNode {
  url: string;
  postback_target: string | null;
  depth: number;
}

export interface CrawlerState {
  domain: string;
  pending_queue: CrawlerNode[];
  visited_nodes: string[]; // hashes: hash(url + postback_target + title)
  depth_map: Record<string, number>; // hash -> depth
  last_updated_at: string;
  app_map: AppMap;
}
