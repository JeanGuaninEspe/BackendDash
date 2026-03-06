export const DASHBOARD_AI_CHART_TYPES = ['bar', 'line', 'area', 'pie', 'kpi'] as const;
export const DASHBOARD_AI_DATASETS = ['recaudacion', 'transitos', 'facturacion'] as const;
export const DASHBOARD_AI_AGGREGATIONS = ['sum', 'count', 'avg'] as const;

export type DashboardAiChartType = (typeof DASHBOARD_AI_CHART_TYPES)[number];
export type DashboardAiDataset = (typeof DASHBOARD_AI_DATASETS)[number];
export type DashboardAiAggregation = (typeof DASHBOARD_AI_AGGREGATIONS)[number];
export type DashboardAiDecisionSource =
  | 'user_override'
  | 'ai'
  | 'rule_override'
  | 'fallback';

export type DashboardAiInsightConfidence = 'low' | 'medium' | 'high';

export interface DashboardAiInsights {
  source: 'ai' | 'fallback';
  summary: string;
  highlights: string[];
  risks: string[];
  confidence: DashboardAiInsightConfidence;
}

export interface DashboardAiFilters {
  rango?:
    | 'ultimos7d'
    | 'ultimos15d'
    | 'ultimos90d'
    | 'mesActual'
    | 'ultimoMes'
    | 'ultimos7dAnterior'
    | 'ultimos15dAnterior'
    | 'ultimos90dAnterior'
    | 'ultimoMesAnterior';
  fechaInicio?: string;
  fechaFin?: string;
  peaje?: string;
  turno?: number;
  anio?: number | number[];
  mes?: number | string | Array<number | string>;
}

export interface DashboardAiPlan {
  chartType: DashboardAiChartType;
  dataset: DashboardAiDataset;
  dimension: string;
  breakdown?: string;
  metric: string;
  aggregation: DashboardAiAggregation;
  filters?: DashboardAiFilters;
  limit?: number;
  title?: string;
  explanation: string;
}

export interface DashboardAiChartResponse {
  schemaVersion: '1.0';
  chart: {
    type: DashboardAiChartType;
    title: string;
    labels: string[];
    series: Array<{ name: string; data: number[] }>;
  };
  query: {
    dataset: DashboardAiDataset;
    dimension: string;
    breakdown?: string;
    metric: string;
    aggregation: DashboardAiAggregation;
    filters: DashboardAiFilters;
    limit: number;
  };
  explanation: string;
  rows: Array<{ label: string; value: number }>;
  chartDecision: {
    selectedType: DashboardAiChartType;
    source: DashboardAiDecisionSource;
    reason: string;
    suggestedType?: DashboardAiChartType;
  };
  insights?: DashboardAiInsights;
  debug?: {
    sqlFiltersApplied: Record<string, unknown>;
    emptyReason?: string;
    insightsFallbackReason?: string;
  };
}
