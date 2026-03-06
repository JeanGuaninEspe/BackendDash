import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma-service/prisma-service.service';
import { DashboardAiInsightsDto } from './dto/dashboard-ai-insights.dto';
import { DashboardAiQueryDto } from './dto/dashboard-ai-query.dto';
import {
  DASHBOARD_AI_AGGREGATIONS,
  DASHBOARD_AI_CHART_TYPES,
  DASHBOARD_AI_DATASETS,
  DashboardAiAggregation,
  DashboardAiChartResponse,
  DashboardAiChartType,
  DashboardAiDecisionSource,
  DashboardAiDataset,
  DashboardAiFilters,
  DashboardAiInsightConfidence,
  DashboardAiInsights,
  DashboardAiPlan,
} from './dashboard-ai.types';

type DatasetConfig = {
  from: Prisma.Sql;
  dateColumn?: Prisma.Sql;
  dimensionOrder: string[];
  metricOrder: string[];
  defaultChartType: 'bar' | 'line' | 'area' | 'pie' | 'kpi';
  dimensions: Record<string, Prisma.Sql>;
  metrics: Record<string, Prisma.Sql | null>;
  filters: Partial<Record<'peaje' | 'turno' | 'anio' | 'mes', Prisma.Sql>>;
};

type WhereClauseResult = {
  whereSql: Prisma.Sql;
  appliedFilters: Record<string, unknown>;
};

type PlanExecutionResult = {
  rows: Array<{ label: string; value: number }>;
  appliedFilters: Record<string, unknown>;
  labels: string[];
  series: Array<{ name: string; data: number[] }>;
};

type ChartDecision = {
  selectedType: DashboardAiChartType;
  source: DashboardAiDecisionSource;
  reason: string;
  suggestedType?: DashboardAiChartType;
};

type InsightsBuildResult = {
  insights?: DashboardAiInsights;
  fallbackReason?: string;
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_NAMES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const DATASET_CONFIG: Record<DashboardAiDataset, DatasetConfig> = {
  recaudacion: {
    from: Prisma.sql`[VW_RECAUDA_COSAD] rc`,
    dateColumn: Prisma.sql`rc.FECHA_HORARIO`,
    dimensionOrder: ['fecha', 'peaje', 'turno', 'mes', 'anio'],
    metricOrder: ['totalDepositado', 'recaudacionEfectivo', 'recaudaFact', 'transitos'],
    defaultChartType: 'bar',
    dimensions: {
      fecha: Prisma.sql`CAST(rc.FECHA_HORARIO AS date)`,
      peaje: Prisma.sql`rc.NOMBRE_PEAJE`,
      turno: Prisma.sql`CAST(rc.TURNO AS varchar(20))`,
      mes: Prisma.sql`rc.mes`,
      anio: Prisma.sql`CAST(rc.[YEAR] AS varchar(10))`,
    },
    metrics: {
      totalDepositado: Prisma.sql`rc.TOTAL_DEPOSITADO`,
      recaudacionEfectivo: Prisma.sql`rc.RECAUDA_EFECTIVO`,
      recaudaFact: Prisma.sql`rc.RECAUDA_FACT`,
      transitos: null,
    },
    filters: {
      peaje: Prisma.sql`rc.NOMBRE_PEAJE`,
      turno: Prisma.sql`rc.TURNO`,
      anio: Prisma.sql`rc.[YEAR]`,
      mes: Prisma.sql`rc.mes`,
    },
  },
  transitos: {
    from: Prisma.sql`[VISTA_TRANSITOS] vt`,
    dateColumn: Prisma.sql`vt.FECHA`,
    dimensionOrder: ['fecha', 'peaje', 'cabina', 'categoria', 'turno'],
    metricOrder: ['transitos', 'costoTotal'],
    defaultChartType: 'line',
    dimensions: {
      fecha: Prisma.sql`CAST(vt.FECHA AS date)`,
      peaje: Prisma.sql`vt.PEAJE`,
      cabina: Prisma.sql`CAST(vt.CABINA AS varchar(20))`,
      categoria: Prisma.sql`vt.CATEGORIA`,
      turno: Prisma.sql`CAST(vt.TURNO AS varchar(20))`,
    },
    metrics: {
      transitos: null,
      costoTotal: Prisma.sql`vt.COSTO`,
    },
    filters: {
      peaje: Prisma.sql`vt.PEAJE`,
      turno: Prisma.sql`vt.TURNO`,
      anio: Prisma.sql`vt.ANIO`,
      mes: Prisma.sql`vt.MES`,
    },
  },
  facturacion: {
    from: Prisma.sql`[FACTURACION_COSAD] fc`,
    dateColumn: Prisma.sql`fc.FECHA_FACTURA`,
    dimensionOrder: ['fecha', 'peaje', 'tipo', 'turno', 'anio'],
    metricOrder: ['totalFacturado', 'subtotal', 'iva', 'facturas'],
    defaultChartType: 'bar',
    dimensions: {
      fecha: Prisma.sql`CAST(fc.FECHA_FACTURA AS date)`,
      peaje: Prisma.sql`fc.NOMBRE_PEAJE`,
      tipo: Prisma.sql`fc.TIPO`,
      turno: Prisma.sql`CAST(fc.TURNO AS varchar(20))`,
      anio: Prisma.sql`CAST(fc.[YEAR] AS varchar(10))`,
    },
    metrics: {
      totalFacturado: Prisma.sql`fc.TOTAL`,
      subtotal: Prisma.sql`fc.SUBTOTAL`,
      iva: Prisma.sql`fc.IVA`,
      facturas: null,
    },
    filters: {
      peaje: Prisma.sql`fc.NOMBRE_PEAJE`,
      turno: Prisma.sql`fc.TURNO`,
      anio: Prisma.sql`fc.[YEAR]`,
      mes: Prisma.sql`fc.mes`,
    },
  },
};

@Injectable()
export class DashboardAiService {
  private readonly logger = new Logger(DashboardAiService.name);
  private llmNextAllowedAt = 0;
  private llmLastPurpose: 'planner' | 'insights' | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async query(dto: DashboardAiQueryDto): Promise<DashboardAiChartResponse> {
    const includeInsights = dto.includeInsights === true;
    const aiDraft = await this.buildPlanFromAi(dto.prompt);
    const aiSuggestedChartType = this.parseChartType(aiDraft.chartType);
    const sanitizedPlan = this.sanitizePlan(aiDraft, dto.limit);
    const plan = this.enrichPlanFiltersFromPrompt(sanitizedPlan, dto.prompt);
    const execution = await this.executePlan(plan);
    const rows = execution.rows;
    const chartDecision = this.resolveChartDecision({
      preferredChartType: dto.preferredChartType,
      aiSuggestedChartType,
      fallbackType: plan.chartType,
      dimension: plan.dimension,
      rows,
    });

    const labels = rows.map((row) => row.label);
    const values = rows.map((row) => row.value);
    const title =
      plan.title?.trim() ||
      `${this.capitalize(plan.metric)} por ${this.capitalize(plan.dimension)}`;

    const response: DashboardAiChartResponse = {
      schemaVersion: '1.0',
      chart: {
        type: chartDecision.selectedType,
        title,
        labels: execution.labels.length ? execution.labels : labels,
        series: execution.series.length ? execution.series : [{ name: this.capitalize(plan.metric), data: values }],
      },
      query: {
        dataset: plan.dataset,
        dimension: plan.dimension,
        breakdown: plan.breakdown,
        metric: plan.metric,
        aggregation: plan.aggregation,
        filters: plan.filters ?? {},
        limit: plan.limit ?? 30,
      },
      explanation: plan.explanation,
      rows,
      chartDecision,
    };

    if (rows.length === 0) {
      response.debug = {
        sqlFiltersApplied: execution.appliedFilters,
        emptyReason: 'No se encontraron registros para los filtros aplicados.',
      };
    }

    if (includeInsights) {
      const insightsResult = await this.buildInsights({
        prompt: dto.prompt,
        chartType: response.chart.type,
        labels: response.chart.labels,
        series: response.chart.series,
        rows: response.rows,
        query: response.query,
      });
      if (insightsResult.insights) {
        response.insights = insightsResult.insights;
      }

      if (insightsResult.fallbackReason) {
        response.debug = {
          ...(response.debug ?? { sqlFiltersApplied: execution.appliedFilters }),
          insightsFallbackReason: insightsResult.fallbackReason,
        };
      }
    }

    return response;
  }

  async insights(dto: DashboardAiInsightsDto) {
    const labels = dto.chart?.labels ?? dto.rows.map((row) => row.label);
    const chartSeries = dto.chart?.series ?? [
      {
        name: 'Valor',
        data: dto.rows.map((row) => Number(row.value)),
      },
    ];

    const chartType = this.parseChartType(dto.chart?.type) ?? 'bar';
    const insightsResult = await this.buildInsights({
      prompt: dto.prompt,
      chartType,
      labels,
      series: chartSeries,
      rows: dto.rows.map((row) => ({ label: row.label, value: Number(row.value) })),
      query: dto.query,
    });

    if (!insightsResult.insights) {
      throw new ServiceUnavailableException(
        insightsResult.fallbackReason ?? 'No se pudo generar insights con proveedor IA.',
      );
    }

    return {
      schemaVersion: '1.0',
      insights: insightsResult.insights,
      debug: insightsResult.fallbackReason
        ? { insightsFallbackReason: insightsResult.fallbackReason }
        : undefined,
    };
  }

  private async buildPlanFromAi(prompt: string): Promise<Partial<DashboardAiPlan>> {
    const llmGate = await this.acquireLlmRequestSlot('planner', this.getPlannerMaxWaitMs());
    if (!llmGate.allowed) {
      throw new ServiceUnavailableException(llmGate.reason ?? 'Planner IA no disponible por throttling.');
    }

    const { apiKey, endpoint } = this.getLlmProvider();

    if (!apiKey) {
      throw new ServiceUnavailableException('API_FREE_LLM no configurada para planner IA.');
    }

    const allowedDatasets = DASHBOARD_AI_DATASETS.join(', ');
    const chartTypes = DASHBOARD_AI_CHART_TYPES.join(', ');
    const aggregations = DASHBOARD_AI_AGGREGATIONS.join(', ');

    const schemaText = DASHBOARD_AI_DATASETS.map((dataset) => {
      const cfg = DATASET_CONFIG[dataset];
      return `- ${dataset}: dimensions=[${cfg.dimensionOrder.join(', ')}], metrics=[${cfg.metricOrder.join(', ')}]`;
    }).join('\n');

    const systemPrompt = `Eres un planner para dashboard BI. Responde UNICAMENTE un JSON valido con esta forma:
{
  "chartType": "bar|line|area|pie|kpi",
  "dataset": "recaudacion|transitos|facturacion",
  "dimension": "dimension_valida",
  "breakdown": "dimension_valida_opcional",
  "metric": "metrica_valida",
  "aggregation": "sum|count|avg",
  "filters": {
    "rango": "ultimos7d|ultimos15d|ultimos90d|mesActual|ultimoMes|ultimos7dAnterior|ultimos15dAnterior|ultimos90dAnterior|ultimoMesAnterior",
    "fechaInicio": "YYYY-MM-DD",
    "fechaFin": "YYYY-MM-DD",
    "peaje": "texto",
    "turno": 1,
    "anio": 2026,
    "mes": 1,
    "anios": [2025, 2026],
    "meses": [1, 2]
  },
  "limit": 30,
  "title": "titulo corto",
  "explanation": "explicacion corta en espanol"
}
Reglas:
- Dataset permitido: ${allowedDatasets}
- Tipo de grafico permitido: ${chartTypes}
- Agregacion permitida: ${aggregations}
- Usa SOLO dimensiones y metricas validas:
${schemaText}
- Puedes omitir chartType si no estas seguro; el backend decidira el mejor tipo.
- No incluyas markdown ni texto fuera del JSON.`;

    const plannerMessage = this.buildPlannerMessage(systemPrompt, prompt);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: plannerMessage,
        }),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        this.logger.warn(`Planner IA fallo con status ${response.status}: ${bodyText.slice(0, 220)}`);
        throw new ServiceUnavailableException(`Proveedor planner retorno status ${response.status}.`);
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const content = this.extractProviderText(payload);
      if (!content) {
        throw new ServiceUnavailableException('Proveedor planner sin contenido de texto.');
      }

      return this.parseJsonPlan(content);
    } catch (error) {
      this.logger.warn('No se pudo consultar el planner IA externo.');
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(this.buildPlannerErrorMessage(error));
    }
  }

  private getLlmProvider() {
    const apiKey = this.configService.get<string>('API_FREE_LLM');
    const endpoint =
      this.configService.get<string>('URL_LLM') ??
      this.configService.get<string>('AI_CHAT_ENDPOINT') ??
      'https://apifreellm.com/api/v1/chat';

    return { apiKey, endpoint };
  }

  private async buildInsights(input: {
    prompt: string;
    chartType: DashboardAiChartType;
    labels: string[];
    series: Array<{ name: string; data: number[] }>;
    rows: Array<{ label: string; value: number }>;
    query: DashboardAiChartResponse['query'];
  }): Promise<InsightsBuildResult> {
    const { rows, query, labels, series, prompt, chartType } = input;

    const total = rows.reduce((acc, row) => acc + row.value, 0);
    const avg = rows.length ? total / rows.length : 0;
    const maxRow = rows.length
      ? rows.reduce((best, current) => (current.value > best.value ? current : best), rows[0])
      : null;
    const minRow = rows.length
      ? rows.reduce((best, current) => (current.value < best.value ? current : best), rows[0])
      : null;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const variationPct = first && last && first.value !== 0
      ? ((last.value - first.value) / first.value) * 100
      : null;
    const concentration = total === 0 || !maxRow ? 0 : (maxRow.value / total) * 100;

    const statsPayload = {
      dataset: query.dataset,
      dimension: query.dimension,
      breakdown: query.breakdown,
      metric: query.metric,
      aggregation: query.aggregation,
      chartType,
      rowCount: rows.length,
      total,
      average: avg,
      max: maxRow,
      min: minRow,
      variationPct,
      concentrationPct: concentration,
      labelsSample: labels.slice(0, 12),
      seriesSample: series.slice(0, 4),
      seriesTotals: series.slice(0, 8).map((serie) => ({
        name: serie.name,
        total: serie.data.reduce((acc, value) => acc + this.toNumber(value), 0),
      })),
      topRows: [...rows].sort((a, b) => b.value - a.value).slice(0, 5),
      bottomRows: [...rows].sort((a, b) => a.value - b.value).slice(0, 3),
    };

    const aiInsight = await this.buildInsightsFromAi(prompt, statsPayload);
    if (aiInsight.insights) {
      return {
        insights: aiInsight.insights,
      };
    }

    return {
      fallbackReason: aiInsight.reason ?? 'No se pudo generar insights con IA.',
    };
  }

  private async buildInsightsFromAi(
    prompt: string,
    statsPayload: Record<string, unknown>,
  ): Promise<{ insights?: DashboardAiInsights; reason?: string }> {
    const llmGate = await this.acquireLlmRequestSlot('insights', this.getInsightsMaxWaitMs());
    if (!llmGate.allowed) {
      return {
        reason: llmGate.reason,
      };
    }

    const { apiKey, endpoint } = this.getLlmProvider();
    if (!apiKey) {
      return { reason: 'API_FREE_LLM no configurada.' };
    }

    const systemPrompt = `Eres analista de datos para dashboards ejecutivos.\nDevuelve UNICAMENTE JSON con esta estructura:\n{\n  "summary": "texto corto",\n  "highlights": ["punto 1", "punto 2"],\n  "risks": ["riesgo 1"],\n  "confidence": "low|medium|high"\n}\nReglas:\n- Maximo 3 frases en summary.\n- highlights: 5 a 8 hallazgos concretos y cuantificados.\n- risks: 4 a 5 riesgos relevantes y accionables.\n- NO incluyas recommendations ni otro campo adicional.\n- Si existe breakdown/series, compara explicitamente los grupos (ej: peajes), indicando diferencias de participacion y brechas de rendimiento.\n- Enfoca el analisis en composicion, concentracion, segmentos lideres, estacionalidad y patrones operativos.\n- Evita centrarte en "variacion negativa/positiva" salvo que el impacto sea critico y este sustentado en datos.\n- Usa tono ejecutivo, claro y orientado a decisiones.\n- No inventes datos fuera del payload.`;

    const message = `${systemPrompt}\n\nPrompt original del usuario:\n${prompt}\n\nPayload estadistico:\n${JSON.stringify(statsPayload)}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const cooldownMs = this.getInsightsRateLimitCooldownMs();
          this.llmNextAllowedAt = Date.now() + cooldownMs;
        }
        this.logger.warn(`Insights IA fallo con status ${response.status}`);
        return { reason: `Proveedor insights retorno status ${response.status}.` };
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const text = this.extractProviderText(payload);
      if (!text) {
        this.logger.warn('Insights IA sin contenido de texto utilizable.');
        return { reason: 'Respuesta del proveedor sin contenido de texto.' };
      }

      const parsed = this.tryParseInsights(text);
      if (!parsed) {
        this.logger.warn('Insights IA no pudo parsearse como JSON/Texto estructurado.');
        return { reason: 'No se pudo parsear salida del proveedor en formato insights.' };
      }

      return {
        insights: {
          source: 'ai',
          summary: parsed.summary,
          highlights: parsed.highlights,
          risks: parsed.risks,
          confidence: parsed.confidence,
        },
      };
    } catch {
      this.logger.warn('Excepcion al generar insights con IA externa.');
      return { reason: 'Excepcion de red o parsing durante insights con IA.' };
    }
  }

  private getPlannerMaxWaitMs() {
    const raw = this.configService.get<string>('AI_PLANNER_MAX_WAIT_MS');
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return 26_000;
  }

  private getInsightsRateLimitCooldownMs() {
    const raw = this.configService.get<string>('AI_INSIGHTS_RATE_LIMIT_COOLDOWN_MS');
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 1_000) {
      return parsed;
    }
    return 60_000;
  }

  private getLlmMinIntervalMs() {
    const raw = this.configService.get<string>('AI_MIN_REQUEST_INTERVAL_MS');
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 1_000) {
      return parsed;
    }
    return 25_000;
  }

  private getInsightsMaxWaitMs() {
    const raw = this.configService.get<string>('AI_INSIGHTS_MAX_WAIT_MS');
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return 26_000;
  }

  private async acquireLlmRequestSlot(
    purpose: 'planner' | 'insights',
    maxWaitMs = 0,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const firstTry = this.tryAcquireLlmRequestSlot(purpose);
    if (firstTry.allowed || maxWaitMs <= 0) {
      return firstTry;
    }

    const now = Date.now();
    const waitMs = Math.max(0, this.llmNextAllowedAt - now);
    if (waitMs <= 0 || waitMs > maxWaitMs) {
      return {
        allowed: false,
        reason: `${firstTry.reason} Espera requerida (${Math.ceil(waitMs / 1000)}s) supera limite permitido (${Math.ceil(maxWaitMs / 1000)}s).`,
      };
    }

    await this.delay(waitMs);
    return this.tryAcquireLlmRequestSlot(purpose);
  }

  private tryAcquireLlmRequestSlot(purpose: 'planner' | 'insights') {
    const now = Date.now();
    if (now < this.llmNextAllowedAt) {
      const waitMs = this.llmNextAllowedAt - now;
      const last = this.llmLastPurpose ?? 'llm';
      return {
        allowed: false,
        reason: `Throttle global del proveedor: ultima llamada ${last}. Reintentar en ~${Math.ceil(waitMs / 1000)}s.`,
      };
    }

    this.llmLastPurpose = purpose;
    this.llmNextAllowedAt = now + this.getLlmMinIntervalMs();
    return { allowed: true as const };
  }

  private delay(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private buildPlannerErrorMessage(error: unknown) {
    if (error instanceof Error) {
      const msg = error.message?.trim();
      if (msg) {
        return `No se pudo consultar el planner IA externo: ${msg}`;
      }
    }
    return 'No se pudo consultar el planner IA externo.';
  }

  private tryParseInsights(text: string): Omit<DashboardAiInsights, 'source'> | undefined {
    const normalizedText = this.stripMarkdownCodeFence(text).trim();
    const parsedFromJson = this.tryParseInsightsFromJson(normalizedText);
    if (parsedFromJson) {
      return parsedFromJson;
    }

    const parsedFromKeyValueText = this.tryParseInsightsFromKeyValueText(normalizedText);
    if (parsedFromKeyValueText) {
      return parsedFromKeyValueText;
    }

    return this.tryParseInsightsFromPlainText(normalizedText);
  }

  private tryParseInsightsFromJson(text: string): Omit<DashboardAiInsights, 'source'> | undefined {
    const tryBuild = (raw: Record<string, unknown>) => {
      const summary = this.pickString(raw, ['summary', 'resumen', 'analysis', 'analisis'])?.slice(0, 400) ?? '';
      if (!summary) {
        return undefined;
      }

      const confidenceValue = this.pickString(raw, ['confidence', 'confianza', 'confidenceLevel']);
      const confidenceRaw = confidenceValue ? confidenceValue.toLowerCase() : 'medium';
      const confidence: DashboardAiInsightConfidence =
        confidenceRaw === 'low' || confidenceRaw === 'high' ? confidenceRaw : 'medium';

      const highlights =
        this.sanitizeInsightList(this.pickArray(raw, ['highlights', 'hallazgos', 'puntosClave', 'insights']), 8);
      const risks = this.sanitizeInsightList(this.pickArray(raw, ['risks', 'riesgos', 'alerts', 'alertas']), 5);

      return {
        summary,
        highlights,
        risks,
        confidence,
      };
    };

    try {
      const direct = JSON.parse(text) as Record<string, unknown>;
      return tryBuild(direct);
    } catch {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) {
        return undefined;
      }

      try {
        const slicedRaw = text.slice(start, end + 1);
        const sliced = JSON.parse(slicedRaw) as Record<string, unknown>;
        return tryBuild(sliced);
      } catch {
        const relaxed = this.relaxJsonText(text.slice(start, end + 1));
        if (!relaxed) {
          return undefined;
        }
        try {
          const parsed = JSON.parse(relaxed) as Record<string, unknown>;
          return tryBuild(parsed);
        } catch {
          return undefined;
        }
      }
    }
  }

  private tryParseInsightsFromPlainText(text: string): Omit<DashboardAiInsights, 'source'> | undefined {
    if (!text.trim()) {
      return undefined;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (!lines.length) {
      return undefined;
    }

    const bulletCandidates = lines
      .map((line) => this.cleanInsightTextLine(line))
      .filter((line) => line.length > 0);

    const summary = bulletCandidates[0]?.slice(0, 400);
    if (!summary) {
      return undefined;
    }

    const tail = bulletCandidates.slice(1);
    const highlights = tail.slice(0, 8);
    const risks = tail.filter((line) => /riesgo|alerta|desviaci|cuello|dependencia|exposicion|vulnerabilidad/i.test(line)).slice(0, 5);

    return {
      summary,
      highlights: highlights.map((line) => this.cleanInsightTextLine(line)).filter((line) => line.length > 0),
      risks: risks.map((line) => this.cleanInsightTextLine(line)).filter((line) => line.length > 0),
      confidence: 'medium',
    };
  }

  private tryParseInsightsFromKeyValueText(text: string): Omit<DashboardAiInsights, 'source'> | undefined {
    const summary = this.extractQuotedField(text, ['summary', 'resumen', 'analysis', 'analisis']);
    const highlights = this.extractArrayLikeField(text, ['highlights', 'hallazgos', 'puntosClave', 'insights']);
    const risks = this.extractArrayLikeField(text, ['risks', 'riesgos', 'alerts', 'alertas']);
    const confidenceRaw = this.extractQuotedField(text, ['confidence', 'confianza', 'confidenceLevel'])?.toLowerCase();
    const confidence: DashboardAiInsightConfidence =
      confidenceRaw === 'low' || confidenceRaw === 'high' ? confidenceRaw : 'medium';

    const cleanedSummary = summary ? this.cleanInsightTextLine(summary).slice(0, 400) : '';
    const cleanedHighlights = highlights.map((item) => this.cleanInsightTextLine(item)).filter((item) => item.length > 0).slice(0, 8);
    const cleanedRisks = risks.map((item) => this.cleanInsightTextLine(item)).filter((item) => item.length > 0).slice(0, 5);

    if (!cleanedSummary && cleanedHighlights.length === 0 && cleanedRisks.length === 0) {
      return undefined;
    }

    return {
      summary: cleanedSummary || (cleanedHighlights[0] ?? cleanedRisks[0] ?? '').slice(0, 400),
      highlights: cleanedHighlights,
      risks: cleanedRisks,
      confidence,
    };
  }

  private stripMarkdownCodeFence(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
      return trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim();
    }
    return text;
  }

  private sanitizeInsightList(value: unknown, maxItems: number): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => this.cleanInsightTextLine(item))
      .filter((item) => item.length > 0)
      .slice(0, maxItems);
  }

  private extractQuotedField(text: string, keys: string[]): string | undefined {
    for (const key of keys) {
      const regex = new RegExp(`(?:\\"|^|\\b)${key}(?:\\"|\\b)\\s*[:=]\\s*([\\"'])([\\s\\S]*?)\\1`, 'i');
      const match = text.match(regex);
      if (match?.[2]?.trim()) {
        return match[2].trim();
      }

      const simpleRegex = new RegExp(`(?:\\"|^|\\b)${key}(?:\\"|\\b)\\s*[:=]\\s*([^\\n\\r]+)`, 'i');
      const simpleMatch = text.match(simpleRegex);
      if (simpleMatch?.[1]?.trim()) {
        return simpleMatch[1].trim();
      }
    }

    return undefined;
  }

  private extractArrayLikeField(text: string, keys: string[]): string[] {
    for (const key of keys) {
      const blockRegex = new RegExp(`(?:\\"|^|\\b)${key}(?:\\"|\\b)\\s*[:=]\\s*\\[([\\s\\S]*?)\\]`, 'i');
      const blockMatch = text.match(blockRegex);
      if (blockMatch?.[1]) {
        return blockMatch[1]
          .split(/\r?\n|,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/)
          .map((item) => this.cleanInsightTextLine(item))
          .filter((item) => item.length > 0);
      }
    }

    return [];
  }

  private cleanInsightTextLine(line: string): string {
    return line
      .replace(/^[-*•]\s*/, '')
      .replace(/^\s*(summary|resumen|highlights|hallazgos|risks|riesgos|confidence|confianza)\s*[:=]\s*/i, '')
      .replace(/^\s*"+|"+\s*$/g, '')
      .replace(/^\s*'+|'+\s*$/g, '')
      .replace(/^\s*\[+|\]+\s*$/g, '')
      .replace(/^\s*\{+|\}+\s*$/g, '')
      .replace(/^\s*,+|,+\s*$/g, '')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\*\*/g, '')
      .trim();
  }

  private pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private pickArray(source: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
      const value = source[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
    return undefined;
  }

  private relaxJsonText(jsonText: string): string | undefined {
    if (!jsonText.trim()) {
      return undefined;
    }

    const withoutTrailingCommas = jsonText.replace(/,(\s*[}\]])/g, '$1');
    const withQuotedKeys = withoutTrailingCommas.replace(/([{,]\s*)([a-zA-Z_][\w-]*)(\s*:)/g, '$1"$2"$3');
    const withDoubleQuotes = withQuotedKeys.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
    return withDoubleQuotes;
  }

  private buildPlannerMessage(systemPrompt: string, userPrompt: string): string {
    return `${systemPrompt}\n\nSolicitud del usuario:\n${userPrompt}`;
  }

  private extractProviderText(payload: Record<string, unknown>): string | undefined {
    const directKeys = ['response', 'message', 'content', 'text', 'result'];
    for (const key of directKeys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }

    const choices = payload.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const firstChoice = choices[0] as { message?: { content?: string }; text?: string };
      if (typeof firstChoice?.message?.content === 'string') {
        return firstChoice.message.content;
      }
      if (typeof firstChoice?.text === 'string') {
        return firstChoice.text;
      }
    }

    const data = payload.data;
    if (data && typeof data === 'object') {
      const nested = data as Record<string, unknown>;
      for (const key of directKeys) {
        const value = nested[key];
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }
    }

    return undefined;
  }

  private parseJsonPlan(content: string): Partial<DashboardAiPlan> {
    const trimmed = content.trim();

    const direct = this.tryParsePlannerObject(trimmed);
    if (direct) {
      return direct;
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidateJson = trimmed.slice(firstBrace, lastBrace + 1);

      const strict = this.tryParsePlannerObject(candidateJson);
      if (strict) {
        return strict;
      }

      const relaxedJson = this.relaxJsonText(candidateJson);
      if (relaxedJson) {
        const relaxed = this.tryParsePlannerObject(relaxedJson);
        if (relaxed) {
          return relaxed;
        }
      }
    }

    const keyValuePlan = this.tryParsePlannerFromKeyValueText(trimmed);
    if (keyValuePlan) {
      this.logger.warn(
        `Planner IA devolvio salida no JSON estricto, se recupero con parser clave/valor. draftPreview=${this.safePlannerDraftPreview(keyValuePlan as Partial<DashboardAiPlan>)}`,
      );
      return keyValuePlan;
    }

    throw new BadRequestException('La IA no devolvio JSON valido.');
  }

  private tryParsePlannerObject(raw: string): Partial<DashboardAiPlan> | undefined {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return this.coercePlannerObject(parsed);
    } catch {
      return undefined;
    }
  }

  private coercePlannerObject(raw: Record<string, unknown>): Partial<DashboardAiPlan> | undefined {
    const nestedPlan = raw.plan;
    if (nestedPlan && typeof nestedPlan === 'object' && !Array.isArray(nestedPlan)) {
      return this.coercePlannerObject(nestedPlan as Record<string, unknown>);
    }

    const filtersCandidate = raw.filters;
    const filters =
      filtersCandidate && typeof filtersCandidate === 'object' && !Array.isArray(filtersCandidate)
        ? (filtersCandidate as Record<string, unknown>)
        : undefined;

    const plan: Partial<DashboardAiPlan> = {
      chartType: this.pickString(raw, ['chartType', 'chart_type', 'chart', 'tipoGrafico', 'tipo_grafico']) as DashboardAiChartType | undefined,
      dataset: this.pickString(raw, ['dataset', 'dataSet', 'fuente']) as DashboardAiDataset | undefined,
      dimension: this.pickString(raw, ['dimension', 'groupBy', 'xAxis', 'x_axis', 'ejeX', 'eje_x']) ?? undefined,
      breakdown: this.pickString(raw, ['breakdown', 'serie', 'seriesBy', 'separarPor', 'separar_por']) ?? undefined,
      metric: this.pickString(raw, ['metric', 'metrica', 'measure', 'valueField', 'campoValor']) ?? undefined,
      aggregation: this.pickString(raw, ['aggregation', 'agregacion', 'agg']) as DashboardAiAggregation | undefined,
      title: this.pickString(raw, ['title', 'titulo']) ?? undefined,
      explanation: this.pickString(raw, ['explanation', 'explicacion', 'descripcion']) ?? undefined,
    };

    const limitRaw = raw.limit ?? raw.top ?? raw.max;
    if (typeof limitRaw === 'number' && Number.isFinite(limitRaw)) {
      plan.limit = Math.trunc(limitRaw);
    } else if (typeof limitRaw === 'string' && limitRaw.trim()) {
      const parsedLimit = Number(limitRaw);
      if (Number.isFinite(parsedLimit)) {
        plan.limit = Math.trunc(parsedLimit);
      }
    }

    if (filters) {
      plan.filters = filters as DashboardAiFilters;
    }

    const hasUsefulData =
      !!plan.dataset ||
      !!plan.dimension ||
      !!plan.metric ||
      !!plan.aggregation ||
      !!plan.chartType ||
      !!plan.filters;

    return hasUsefulData ? plan : undefined;
  }

  private tryParsePlannerFromKeyValueText(text: string): Partial<DashboardAiPlan> | undefined {
    const dataset = this.extractQuotedField(text, ['dataset', 'dataSet', 'fuente']);
    const dimension = this.extractQuotedField(text, ['dimension', 'groupBy', 'ejeX', 'xAxis']);
    const breakdown = this.extractQuotedField(text, ['breakdown', 'seriesBy', 'separarPor']);
    const metric = this.extractQuotedField(text, ['metric', 'metrica', 'measure']);
    const aggregation = this.extractQuotedField(text, ['aggregation', 'agregacion', 'agg']);
    const chartType = this.extractQuotedField(text, ['chartType', 'chart_type', 'chart', 'tipoGrafico', 'tipo_grafico']);
    const title = this.extractQuotedField(text, ['title', 'titulo']);
    const explanation = this.extractQuotedField(text, ['explanation', 'explicacion', 'descripcion']);

    const anios = this.extractNumberListField(text, ['anios', 'años', 'years']);
    const anio = this.extractSingleNumberField(text, ['anio', 'año', 'year']);
    const meses = this.extractNumberListField(text, ['meses', 'months']);
    const mes = this.extractSingleNumberField(text, ['mes', 'month']);
    const peaje = this.extractQuotedField(text, ['peaje', 'plaza']);
    const turno = this.extractSingleNumberField(text, ['turno', 'shift']);
    const fechaInicio = this.extractDateField(text, ['fechaInicio', 'fecha_inicio', 'startDate']);
    const fechaFin = this.extractDateField(text, ['fechaFin', 'fecha_fin', 'endDate']);
    const rango = this.extractQuotedField(text, ['rango', 'range']);

    const filters: DashboardAiFilters = {
      ...(anios.length ? { anio: anios } : {}),
      ...(!anios.length && anio ? { anio } : {}),
      ...(meses.length ? { mes: meses } : {}),
      ...(!meses.length && mes ? { mes } : {}),
      ...(peaje ? { peaje } : {}),
      ...(turno ? { turno } : {}),
      ...(fechaInicio ? { fechaInicio } : {}),
      ...(fechaFin ? { fechaFin } : {}),
      ...(rango ? { rango: rango as DashboardAiFilters['rango'] } : {}),
    };

    const limit = this.extractSingleNumberField(text, ['limit', 'top', 'max']);

    const plan: Partial<DashboardAiPlan> = {
      dataset: dataset as DashboardAiDataset | undefined,
      dimension: dimension ?? undefined,
      breakdown: breakdown ?? undefined,
      metric: metric ?? undefined,
      aggregation: aggregation as DashboardAiAggregation | undefined,
      chartType: chartType as DashboardAiChartType | undefined,
      title: title ?? undefined,
      explanation: explanation ?? undefined,
      filters: Object.keys(filters).length ? filters : undefined,
      limit: limit ?? undefined,
    };

    const hasUsefulData =
      !!plan.dataset ||
      !!plan.dimension ||
      !!plan.metric ||
      !!plan.aggregation ||
      !!plan.chartType ||
      !!plan.filters;

    return hasUsefulData ? plan : undefined;
  }

  private extractSingleNumberField(text: string, keys: string[]): number | undefined {
    for (const key of keys) {
      const regex = new RegExp(`(?:\\"|^|\\b)${key}(?:\\"|\\b)\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
      const match = text.match(regex);
      if (match?.[1]) {
        const value = Number(match[1]);
        if (Number.isFinite(value)) {
          return Math.trunc(value);
        }
      }
    }
    return undefined;
  }

  private extractNumberListField(text: string, keys: string[]): number[] {
    for (const key of keys) {
      const regex = new RegExp(`(?:\\"|^|\\b)${key}(?:\\"|\\b)\\s*[:=]\\s*\\[([^\\]]+)\\]`, 'i');
      const match = text.match(regex);
      if (!match?.[1]) {
        continue;
      }

      const numbers = Array.from(
        new Set(
          match[1]
            .split(',')
            .map((item) => Number(item.replace(/['\"\s]/g, '')))
            .filter((num) => Number.isFinite(num))
            .map((num) => Math.trunc(num)),
        ),
      );

      if (numbers.length) {
        return numbers;
      }
    }

    return [];
  }

  private extractDateField(text: string, keys: string[]): string | undefined {
    for (const key of keys) {
      const regex = new RegExp(`(?:\\"|^|\\b)${key}(?:\\"|\\b)\\s*[:=]\\s*['\"]?(\\d{4}-\\d{2}-\\d{2})['\"]?`, 'i');
      const match = text.match(regex);
      if (match?.[1]) {
        return match[1];
      }
    }
    return undefined;
  }

  private sanitizePlan(
    draft: Partial<DashboardAiPlan>,
    requestLimit?: number,
  ): DashboardAiPlan {
    const dataset = this.requireValidValue(
      draft.dataset,
      DASHBOARD_AI_DATASETS,
      'Proveedor planner devolvio dataset invalido o vacio.',
    );
    const config = DATASET_CONFIG[dataset];

    const dimension = this.resolveDimension(draft.dimension, dataset, config);

    const breakdown =
      draft.breakdown &&
      draft.breakdown !== dimension &&
      config.dimensionOrder.includes(draft.breakdown)
        ? draft.breakdown
        : undefined;

    const metric = this.resolveMetric(draft.metric, dataset, config);
    const metricSql = config.metrics[metric];

    let aggregation: DashboardAiAggregation =
      draft.aggregation && DASHBOARD_AI_AGGREGATIONS.includes(draft.aggregation)
        ? draft.aggregation
        : 'sum';

    if (!draft.aggregation || !DASHBOARD_AI_AGGREGATIONS.includes(draft.aggregation)) {
      this.logger.warn(
        `Planner IA aggregation invalida. raw='${String(draft.aggregation ?? '')}', fallback='sum', draftPreview=${this.safePlannerDraftPreview(draft)}`,
      );
    }

    if (metricSql === null && aggregation !== 'count') {
      aggregation = 'count';
    }

    const rawChartType = this.extractRawChartType(draft);
    const normalizedChartType = this.normalizeChartTypeFromProvider(rawChartType);

    let chartType: DashboardAiChartType = config.defaultChartType;
    if (normalizedChartType && (DASHBOARD_AI_CHART_TYPES as readonly string[]).includes(normalizedChartType)) {
      chartType = normalizedChartType as DashboardAiChartType;
    } else {
      this.logger.warn(
        `Planner IA chartType invalido. raw='${String(rawChartType ?? '')}', normalized='${String(normalizedChartType ?? '')}', fallback='${config.defaultChartType}', draftPreview=${this.safePlannerDraftPreview(draft)}`,
      );
    }

    const filters = this.sanitizeFilters(draft.filters);
    const safeLimit = Math.min(Math.max(requestLimit ?? draft.limit ?? 30, 1), 200);

    return {
      chartType,
      dataset,
      dimension,
      breakdown,
      metric,
      aggregation,
      filters,
      limit: safeLimit,
      title: draft.title,
      explanation:
        draft.explanation?.trim() ||
        'Explicacion no proporcionada por el proveedor IA.',
    };
  }

  private sanitizeFilters(filters?: DashboardAiFilters | Record<string, unknown>): DashboardAiFilters {
    if (!filters) return {};

    const rawFilters = filters as DashboardAiFilters & {
      anios?: unknown;
      meses?: unknown;
    };

    const safe: DashboardAiFilters = {};
    const allowedRanges = [
      'ultimos7d',
      'ultimos15d',
      'ultimos90d',
      'mesActual',
      'ultimoMes',
      'ultimos7dAnterior',
      'ultimos15dAnterior',
      'ultimos90dAnterior',
      'ultimoMesAnterior',
    ] as const;

    if (rawFilters.rango && allowedRanges.includes(rawFilters.rango)) {
      safe.rango = rawFilters.rango;
    }

    if (rawFilters.fechaInicio && /^\d{4}-\d{2}-\d{2}$/.test(rawFilters.fechaInicio)) {
      safe.fechaInicio = rawFilters.fechaInicio;
    }

    if (rawFilters.fechaFin && /^\d{4}-\d{2}-\d{2}$/.test(rawFilters.fechaFin)) {
      safe.fechaFin = rawFilters.fechaFin;
    }

    if (typeof rawFilters.peaje === 'string' && rawFilters.peaje.trim()) {
      safe.peaje = rawFilters.peaje.trim().slice(0, 80);
    }

    if (Number.isFinite(rawFilters.turno)) {
      const turno = Number(rawFilters.turno);
      if (turno > 0) {
        safe.turno = turno;
      }
    }

    const yearSource = rawFilters.anio ?? rawFilters.anios;
    if (Array.isArray(yearSource)) {
      const years = Array.from(
        new Set(
          yearSource
            .map((year) => Number(year))
            .filter((year) => Number.isFinite(year) && year >= 2000)
            .map((year) => Math.trunc(year)),
        ),
      ).sort((a, b) => a - b);
      if (years.length === 1) {
        safe.anio = years[0];
      } else if (years.length > 1) {
        safe.anio = years;
      }
    } else if (Number.isFinite(yearSource)) {
      const anio = Number(yearSource);
      if (anio >= 2000) {
        safe.anio = Math.trunc(anio);
      }
    }

    const monthSource = rawFilters.mes ?? rawFilters.meses;
    if (Array.isArray(monthSource)) {
      const months = Array.from(
        new Set(
          monthSource
            .filter((month): month is number | string => typeof month === 'number' || typeof month === 'string')
            .map((month) => (typeof month === 'string' ? month.trim() : month))
            .filter((month) => {
              if (typeof month === 'number') {
                return month >= 1 && month <= 12;
              }
              return month.length > 0;
            }),
        ),
      );

      if (months.length === 1) {
        safe.mes = months[0];
      } else if (months.length > 1) {
        safe.mes = months;
      }
    } else if (typeof monthSource === 'number' || typeof monthSource === 'string') {
      if (typeof monthSource === 'number') {
        if (monthSource >= 1 && monthSource <= 12) {
          safe.mes = monthSource;
        }
      } else if (monthSource.trim()) {
        safe.mes = monthSource.trim();
      }
    }

    return safe;
  }

  private async executePlan(plan: DashboardAiPlan): Promise<PlanExecutionResult> {
    const config = DATASET_CONFIG[plan.dataset];
    const dimensionSql = config.dimensions[plan.dimension];
    const breakdownSql = plan.breakdown ? config.dimensions[plan.breakdown] : undefined;
    const metricSql = config.metrics[plan.metric];

    if (!dimensionSql) {
      throw new BadRequestException('Dimension no permitida para el dataset.');
    }

    if (metricSql === null && plan.aggregation !== 'count') {
      plan.aggregation = 'count';
    }

    const valueExpr = this.buildAggregationExpression(plan.aggregation, metricSql);
    const whereClause = this.buildWhereClause(plan.dataset, plan.filters ?? {});
    const top = Prisma.raw(String(plan.limit ?? 30));

    if (plan.breakdown && !breakdownSql) {
      throw new BadRequestException('Breakdown no permitido para el dataset.');
    }

    if (breakdownSql) {
      const orderBySql = this.buildOrderBySql(plan, dimensionSql);
      const query = Prisma.sql`
        SELECT
          ${dimensionSql} AS label,
          ${breakdownSql} AS seriesName,
          ${valueExpr} AS value
        FROM ${config.from}
        ${whereClause.whereSql}
        GROUP BY ${dimensionSql}, ${breakdownSql}
        ORDER BY ${orderBySql}
      `;

      const result = await this.prisma.$queryRaw<Array<{ label: unknown; seriesName: unknown; value: unknown }>>(query);

      const labelsSet = new Set<string>();
      const seriesSet = new Set<string>();
      const matrix = new Map<string, Map<string, number>>();

      for (const row of result) {
        const label = this.normalizeDimensionLabel(plan.dimension, row.label);
        const seriesName = this.normalizeLabel(row.seriesName);
        const value = this.toNumber(row.value);
        labelsSet.add(label);
        seriesSet.add(seriesName);
        if (!matrix.has(label)) {
          matrix.set(label, new Map<string, number>());
        }
        matrix.get(label)!.set(seriesName, value);
      }

      const allLabels = Array.from(labelsSet);
      const totalsByLabel = new Map<string, number>();
      for (const label of allLabels) {
        const perSeries = matrix.get(label);
        const total = perSeries
          ? Array.from(perSeries.values()).reduce((acc, value) => acc + value, 0)
          : 0;
        totalsByLabel.set(label, total);
      }

      const sortedLabels = [...allLabels].sort((a, b) => {
        if (this.isTemporalDimension(plan.dimension)) {
          return this.compareDimensionLabels(plan.dimension, a, b);
        }
        return (totalsByLabel.get(b) ?? 0) - (totalsByLabel.get(a) ?? 0);
      });

      const limitedLabels = sortedLabels.slice(0, plan.limit ?? 30);
      const seriesNames = Array.from(seriesSet).sort((a, b) => a.localeCompare(b));
      const chartSeries = seriesNames.map((seriesName) => ({
        name: seriesName,
        data: limitedLabels.map((label) => matrix.get(label)?.get(seriesName) ?? 0),
      }));

      const rows = limitedLabels.map((label) => ({
        label,
        value: totalsByLabel.get(label) ?? 0,
      }));

      return {
        rows,
        appliedFilters: whereClause.appliedFilters,
        labels: limitedLabels,
        series: chartSeries,
      };
    }

    const orderBySql = this.buildOrderBySql(plan, dimensionSql);

    const query = Prisma.sql`
      SELECT TOP (${top})
        ${dimensionSql} AS label,
        ${valueExpr} AS value
      FROM ${config.from}
      ${whereClause.whereSql}
      GROUP BY ${dimensionSql}
      ORDER BY ${orderBySql}
    `;

    const result = await this.prisma.$queryRaw<Array<{ label: unknown; value: unknown }>>(query);

    const rows = result.map((row) => ({
      label: this.normalizeDimensionLabel(plan.dimension, row.label),
      value: this.toNumber(row.value),
    }));

    return {
      rows,
      appliedFilters: whereClause.appliedFilters,
      labels: rows.map((row) => row.label),
      series: [{ name: this.capitalize(plan.metric), data: rows.map((row) => row.value) }],
    };
  }

  private buildOrderBySql(plan: DashboardAiPlan, dimensionSql: Prisma.Sql): Prisma.Sql {
    if (plan.dimension === 'mes') {
      return this.buildMonthOrderBySql(dimensionSql);
    }

    if (this.isTemporalDimension(plan.dimension) || plan.chartType === 'line' || plan.chartType === 'area') {
      return Prisma.sql`label ASC`;
    }

    return Prisma.sql`value DESC`;
  }

  private buildMonthOrderBySql(dimensionSql: Prisma.Sql): Prisma.Sql {
    const monthExpr = Prisma.sql`UPPER(LTRIM(RTRIM(CAST(${dimensionSql} AS varchar(20)))))`;

    return Prisma.sql`
      CASE
        WHEN ${monthExpr} IN ('1', '01', 'JANUARY', 'ENERO') THEN 1
        WHEN ${monthExpr} IN ('2', '02', 'FEBRUARY', 'FEBRERO') THEN 2
        WHEN ${monthExpr} IN ('3', '03', 'MARCH', 'MARZO') THEN 3
        WHEN ${monthExpr} IN ('4', '04', 'APRIL', 'ABRIL') THEN 4
        WHEN ${monthExpr} IN ('5', '05', 'MAY', 'MAYO') THEN 5
        WHEN ${monthExpr} IN ('6', '06', 'JUNE', 'JUNIO') THEN 6
        WHEN ${monthExpr} IN ('7', '07', 'JULY', 'JULIO') THEN 7
        WHEN ${monthExpr} IN ('8', '08', 'AUGUST', 'AGOSTO') THEN 8
        WHEN ${monthExpr} IN ('9', '09', 'SEPTEMBER', 'SEPTIEMBRE') THEN 9
        WHEN ${monthExpr} IN ('10', 'OCTOBER', 'OCTUBRE') THEN 10
        WHEN ${monthExpr} IN ('11', 'NOVEMBER', 'NOVIEMBRE') THEN 11
        WHEN ${monthExpr} IN ('12', 'DECEMBER', 'DICIEMBRE') THEN 12
        ELSE 99
      END ASC
    `;
  }

  private buildAggregationExpression(
    aggregation: DashboardAiAggregation,
    metricSql: Prisma.Sql | null,
  ): Prisma.Sql {
    if (aggregation === 'count' || !metricSql) {
      return Prisma.sql`COUNT_BIG(1)`;
    }

    if (aggregation === 'avg') {
      return Prisma.sql`AVG(CAST(${metricSql} AS float))`;
    }

    return Prisma.sql`SUM(CAST(${metricSql} AS float))`;
  }

  private buildWhereClause(dataset: DashboardAiDataset, filters: DashboardAiFilters): WhereClauseResult {
    const config = DATASET_CONFIG[dataset];
    const clauses: Prisma.Sql[] = [];
    const appliedFilters: Record<string, unknown> = {};

    const range = this.resolveDateRange(filters);
    if (range && config.dateColumn) {
      if (range.gte) {
        clauses.push(Prisma.sql`${config.dateColumn} >= ${range.gte}`);
        appliedFilters.fechaInicioAplicada = range.gte.toISOString();
      }
      if (range.lte) {
        clauses.push(Prisma.sql`${config.dateColumn} <= ${range.lte}`);
        appliedFilters.fechaFinAplicada = range.lte.toISOString();
      }
      if (filters.rango) {
        appliedFilters.rango = filters.rango;
      }
    }

    if (filters.peaje && config.filters.peaje) {
      clauses.push(Prisma.sql`${config.filters.peaje} = ${filters.peaje}`);
      appliedFilters.peaje = filters.peaje;
    }

    if (Number.isFinite(filters.turno) && config.filters.turno) {
      clauses.push(Prisma.sql`${config.filters.turno} = ${filters.turno}`);
      appliedFilters.turno = filters.turno;
    }

    const years = this.normalizeYearFilter(filters.anio);
    if (years.length > 0 && config.filters.anio) {
      if (years.length === 1) {
        clauses.push(Prisma.sql`${config.filters.anio} = ${years[0]}`);
        appliedFilters.anio = years[0];
      } else {
        clauses.push(Prisma.sql`${config.filters.anio} IN (${Prisma.join(years)})`);
        appliedFilters.anio = years;
      }
    }

    const months = this.normalizeMonthFilterValues(filters.mes);
    if (months.length > 0 && config.filters.mes) {
      const monthCondition = this.buildMonthClauses(config.filters.mes, months);
      clauses.push(monthCondition.whereSql);
      appliedFilters.mes = monthCondition.appliedValue;
    }

    appliedFilters.dataset = dataset;

    if (!clauses.length) {
      return {
        whereSql: Prisma.sql``,
        appliedFilters,
      };
    }

    return {
      whereSql: Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`,
      appliedFilters,
    };
  }

  private resolveDateRange(filters: DashboardAiFilters) {
    if (filters.fechaInicio || filters.fechaFin) {
      const gte = filters.fechaInicio ? new Date(`${filters.fechaInicio}T00:00:00.000Z`) : undefined;
      const lte = filters.fechaFin ? new Date(`${filters.fechaFin}T23:59:59.999Z`) : undefined;
      return { gte, lte };
    }

    if (this.hasCalendarFilter(filters)) {
      return undefined;
    }

    const now = new Date();
    const toStartOfDayUtc = (date: Date) =>
      new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    const normalizedRange = filters.rango?.replace('Anterior', '');
    switch (normalizedRange) {
      case 'ultimos7d':
        return { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), lte: now };
      case 'ultimos15d':
        return { gte: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000), lte: now };
      case 'ultimos90d':
        return { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), lte: now };
      case 'mesActual': {
        const start = toStartOfDayUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
        return { gte: start, lte: now };
      }
      case 'ultimoMes': {
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        const start = toStartOfDayUtc(new Date(Date.UTC(y, m - 1, 1)));
        const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
        return { gte: start, lte: end };
      }
      default:
        return { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), lte: now };
    }
  }

  private normalizeMonthValue(month: number | string): number | string {
    if (typeof month === 'number') {
      if (month >= 1 && month <= 12) {
        return month;
      }
      return month;
    }

    const monthAsNumber = Number(month);
    if (!Number.isNaN(monthAsNumber) && monthAsNumber >= 1 && monthAsNumber <= 12) {
      return MONTH_NAMES[monthAsNumber - 1];
    }

    return month;
  }

  private buildMonthClause(columnSql: Prisma.Sql, rawMonth: number | string) {
    const month = typeof rawMonth === 'string' ? rawMonth.trim() : rawMonth;

    if (typeof month === 'number') {
      const monthAsText = String(month);
      const monthAsText2 = month < 10 ? `0${month}` : monthAsText;
      const monthName = month >= 1 && month <= 12 ? MONTH_NAMES[month - 1] : monthAsText;
      return {
        whereSql: Prisma.sql`(CAST(${columnSql} AS varchar(20)) = ${monthAsText} OR CAST(${columnSql} AS varchar(20)) = ${monthAsText2} OR UPPER(CAST(${columnSql} AS varchar(20))) = UPPER(${monthName}))`,
        appliedValue: month,
      };
    }

    const monthAsNumber = Number(month);
    if (!Number.isNaN(monthAsNumber) && monthAsNumber >= 1 && monthAsNumber <= 12) {
      const monthAsText = String(monthAsNumber);
      const monthAsText2 = monthAsNumber < 10 ? `0${monthAsNumber}` : monthAsText;
      const monthName = MONTH_NAMES[monthAsNumber - 1];
      return {
        whereSql: Prisma.sql`(CAST(${columnSql} AS varchar(20)) = ${monthAsText} OR CAST(${columnSql} AS varchar(20)) = ${monthAsText2} OR UPPER(CAST(${columnSql} AS varchar(20))) = UPPER(${monthName}))`,
        appliedValue: monthAsNumber,
      };
    }

    const monthNameIndex = MONTH_NAMES.findIndex((m) => m.toLowerCase() === month.toLowerCase());
    if (monthNameIndex >= 0) {
      const monthNumber = monthNameIndex + 1;
      const monthAsText = String(monthNumber);
      const monthAsText2 = monthNumber < 10 ? `0${monthNumber}` : monthAsText;
      const monthName = MONTH_NAMES[monthNameIndex];
      return {
        whereSql: Prisma.sql`(UPPER(CAST(${columnSql} AS varchar(20))) = UPPER(${monthName}) OR CAST(${columnSql} AS varchar(20)) = ${monthAsText} OR CAST(${columnSql} AS varchar(20)) = ${monthAsText2})`,
        appliedValue: monthName,
      };
    }

    return {
      whereSql: Prisma.sql`CAST(${columnSql} AS varchar(20)) = ${month}`,
      appliedValue: month,
    };
  }

  private buildMonthClauses(columnSql: Prisma.Sql, rawMonths: Array<number | string>) {
    if (rawMonths.length === 1) {
      return this.buildMonthClause(columnSql, rawMonths[0]);
    }

    const clauses = rawMonths.map((month) => this.buildMonthClause(columnSql, month));
    return {
      whereSql: Prisma.sql`(${Prisma.join(clauses.map((item) => item.whereSql), ' OR ')})`,
      appliedValue: clauses.map((item) => item.appliedValue),
    };
  }

  private normalizeYearFilter(value: DashboardAiFilters['anio']): number[] {
    if (Array.isArray(value)) {
      return Array.from(
        new Set(
          value
            .map((year) => Number(year))
            .filter((year) => Number.isFinite(year) && year >= 2000)
            .map((year) => Math.trunc(year)),
        ),
      ).sort((a, b) => a - b);
    }

    if (Number.isFinite(value)) {
      const year = Math.trunc(Number(value));
      return year >= 2000 ? [year] : [];
    }

    return [];
  }

  private normalizeMonthFilterValues(value: DashboardAiFilters['mes']): Array<number | string> {
    const source = Array.isArray(value) ? value : value !== undefined ? [value] : [];
    if (!source.length) {
      return [];
    }

    const unique = new Set<number | string>();
    for (const month of source) {
      if (typeof month === 'number') {
        if (month >= 1 && month <= 12) {
          unique.add(Math.trunc(month));
        }
        continue;
      }

      const trimmed = month.trim();
      if (!trimmed) {
        continue;
      }

      const monthAsNumber = Number(trimmed);
      if (!Number.isNaN(monthAsNumber) && monthAsNumber >= 1 && monthAsNumber <= 12) {
        unique.add(Math.trunc(monthAsNumber));
      } else {
        unique.add(trimmed);
      }
    }

    return Array.from(unique.values());
  }

  private hasCalendarFilter(filters: DashboardAiFilters): boolean {
    return this.normalizeYearFilter(filters.anio).length > 0 || this.normalizeMonthFilterValues(filters.mes).length > 0;
  }

  private enrichPlanFiltersFromPrompt(plan: DashboardAiPlan, prompt: string): DashboardAiPlan {
    const years = this.extractYearsFromPrompt(prompt);
    const months = this.extractMonthsFromPrompt(prompt);
    if (!years.length && !months.length) {
      return plan;
    }

    const currentFilters = plan.filters ?? {};
    const nextFilters: DashboardAiFilters = { ...currentFilters };
    let changed = false;

    if (!this.normalizeYearFilter(currentFilters.anio).length && years.length) {
      nextFilters.anio = years.length === 1 ? years[0] : years;
      changed = true;
    }

    if (!this.normalizeMonthFilterValues(currentFilters.mes).length && months.length) {
      nextFilters.mes = months.length === 1 ? months[0] : months;
      changed = true;
    }

    if (!changed) {
      return plan;
    }

    this.logger.log(
      `Se enriquecieron filtros desde prompt. dataset=${plan.dataset}, dimension=${plan.dimension}, anio=${JSON.stringify(nextFilters.anio ?? null)}, mes=${JSON.stringify(nextFilters.mes ?? null)}`,
    );

    return {
      ...plan,
      filters: nextFilters,
    };
  }

  private extractYearsFromPrompt(prompt: string): number[] {
    const matches = prompt.match(/\b(20\d{2})\b/g) ?? [];
    const years = Array.from(
      new Set(
        matches
          .map((year) => Number(year))
          .filter((year) => Number.isFinite(year) && year >= 2000 && year <= 2100),
      ),
    ).sort((a, b) => a - b);
    return years;
  }

  private extractMonthsFromPrompt(prompt: string): number[] {
    const normalized = prompt
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ' ');

    const monthMatchers: Array<{ regex: RegExp; month: number }> = [
      { regex: /\benero\b|\bjanuary\b|\bjan\b/, month: 1 },
      { regex: /\bfebrero\b|\bfebruary\b|\bfeb\b/, month: 2 },
      { regex: /\bmarzo\b|\bmarch\b|\bmar\b/, month: 3 },
      { regex: /\babril\b|\bapril\b|\bapr\b/, month: 4 },
      { regex: /\bmayo\b|\bmay\b/, month: 5 },
      { regex: /\bjunio\b|\bjune\b|\bjun\b/, month: 6 },
      { regex: /\bjulio\b|\bjuly\b|\bjul\b/, month: 7 },
      { regex: /\bagosto\b|\baugust\b|\baug\b/, month: 8 },
      { regex: /\bseptiembre\b|\bsetiembre\b|\bseptember\b|\bsep\b/, month: 9 },
      { regex: /\boctubre\b|\boctober\b|\boct\b/, month: 10 },
      { regex: /\bnoviembre\b|\bnovember\b|\bnov\b/, month: 11 },
      { regex: /\bdiciembre\b|\bdecember\b|\bdec\b/, month: 12 },
    ];

    const months = new Set<number>();
    for (const matcher of monthMatchers) {
      if (matcher.regex.test(normalized)) {
        months.add(matcher.month);
      }
    }

    return Array.from(months.values()).sort((a, b) => a - b);
  }

  private resolveChartDecision(params: {
    preferredChartType?: DashboardAiChartType;
    aiSuggestedChartType?: DashboardAiChartType;
    fallbackType: DashboardAiChartType;
    dimension: string;
    rows: Array<{ label: string; value: number }>;
  }): ChartDecision {
    const { preferredChartType, aiSuggestedChartType, fallbackType, dimension, rows } = params;

    if (preferredChartType) {
      return {
        selectedType: preferredChartType,
        source: 'user_override',
        reason: 'Se aplico preferredChartType enviado por el cliente.',
        suggestedType: aiSuggestedChartType,
      };
    }

    let selectedType = aiSuggestedChartType ?? fallbackType;
    let source: DashboardAiDecisionSource = aiSuggestedChartType ? 'ai' : 'fallback';
    let reason = aiSuggestedChartType
      ? 'Se utilizo el tipo sugerido por la IA.'
      : 'No hubo sugerencia valida de IA, se aplico tipo por defecto del backend.';

    const temporal = this.isTemporalDimension(dimension);

    if (rows.length === 0) {
      return {
        selectedType,
        source,
        reason: `${reason} No hubo datos para aplicar reglas de visualizacion por cardinalidad.`,
        suggestedType: aiSuggestedChartType,
      };
    }

    if (rows.length === 1) {
      selectedType = 'kpi';
      source = 'rule_override';
      reason = 'Con una sola categoria se usa KPI para mejorar legibilidad.';
    } else if (temporal && (selectedType === 'pie' || selectedType === 'bar' || selectedType === 'kpi')) {
      selectedType = 'line';
      source = 'rule_override';
      reason = 'Dimension temporal detectada; se prioriza linea para mostrar tendencia.';
    } else if (!temporal && rows.length > 8 && selectedType === 'pie') {
      selectedType = 'bar';
      source = 'rule_override';
      reason = 'Pie con muchas categorias reduce legibilidad; se cambio a barras.';
    }

    return {
      selectedType,
      source,
      reason,
      suggestedType: aiSuggestedChartType,
    };
  }

  private parseChartType(value: unknown): DashboardAiChartType | undefined {
    const normalized = this.normalizeChartTypeFromProvider(value);
    if (!normalized) {
      return undefined;
    }

    if ((DASHBOARD_AI_CHART_TYPES as readonly string[]).includes(normalized)) {
      return normalized as DashboardAiChartType;
    }

    return undefined;
  }

  private extractRawChartType(draft: Partial<DashboardAiPlan>): unknown {
    const raw = draft as Partial<DashboardAiPlan> & {
      chart?: unknown;
      chart_type?: unknown;
      tipoGrafico?: unknown;
      tipo_grafico?: unknown;
    };

    return raw.chartType ?? raw.chart ?? raw.chart_type ?? raw.tipoGrafico ?? raw.tipo_grafico;
  }

  private normalizeChartTypeFromProvider(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const aliases: Record<string, DashboardAiChartType> = {
      bar: 'bar',
      bars: 'bar',
      barra: 'bar',
      barras: 'bar',
      line: 'line',
      lines: 'line',
      linea: 'line',
      lineas: 'line',
      area: 'area',
      pie: 'pie',
      donut: 'pie',
      doughnut: 'pie',
      kpi: 'kpi',
      indicador: 'kpi',
      indicadores: 'kpi',
    };

    return aliases[normalized] ?? normalized;
  }

  private safePlannerDraftPreview(draft: Partial<DashboardAiPlan>) {
    const preview = {
      chartType: draft.chartType,
      dataset: draft.dataset,
      dimension: draft.dimension,
      breakdown: draft.breakdown,
      metric: draft.metric,
      aggregation: draft.aggregation,
      limit: draft.limit,
      title: draft.title,
    };

    try {
      return JSON.stringify(preview);
    } catch {
      return '[unserializable]';
    }
  }

  private isTemporalDimension(dimension: string): boolean {
    const normalized = dimension.toLowerCase();
    return (
      normalized === 'fecha' ||
      normalized === 'anio' ||
      normalized === 'año' ||
      normalized === 'mes' ||
      normalized === 'semana'
    );
  }

  private requireValidValue<T extends readonly string[]>(
    value: string | undefined,
    allowed: T,
    errorMessage: string,
  ): T[number] {
    if (value && (allowed as readonly string[]).includes(value)) {
      return value as T[number];
    }
    throw new BadRequestException(errorMessage);
  }

  private requireValidString(value: string | undefined, allowed: string[], errorMessage: string) {
    if (value && allowed.includes(value)) {
      return value;
    }
    throw new BadRequestException(errorMessage);
  }

  private resolveDimension(
    rawDimension: unknown,
    dataset: DashboardAiDataset,
    config: DatasetConfig,
  ): string {
    if (typeof rawDimension === 'string' && config.dimensionOrder.includes(rawDimension)) {
      return rawDimension;
    }

    const alias = this.normalizeAliasKey(rawDimension);
    const aliasesByDataset: Record<DashboardAiDataset, Record<string, string>> = {
      recaudacion: {
        fecha: 'fecha',
        date: 'fecha',
        peaje: 'peaje',
        plaza: 'peaje',
        turno: 'turno',
        shift: 'turno',
        mes: 'mes',
        month: 'mes',
        anio: 'anio',
        ano: 'anio',
        year: 'anio',
      },
      transitos: {
        fecha: 'fecha',
        date: 'fecha',
        peaje: 'peaje',
        plaza: 'peaje',
        cabina: 'cabina',
        lane: 'cabina',
        categoria: 'categoria',
        category: 'categoria',
        turno: 'turno',
        shift: 'turno',
      },
      facturacion: {
        fecha: 'fecha',
        date: 'fecha',
        peaje: 'peaje',
        plaza: 'peaje',
        tipo: 'tipo',
        type: 'tipo',
        turno: 'turno',
        shift: 'turno',
        anio: 'anio',
        ano: 'anio',
        year: 'anio',
      },
    };

    const mapped = alias ? aliasesByDataset[dataset][alias] : undefined;
    if (mapped && config.dimensionOrder.includes(mapped)) {
      return mapped;
    }

    const fallback = config.dimensionOrder.includes('peaje') ? 'peaje' : config.dimensionOrder[0];
    this.logger.warn(
      `Planner IA dimension invalida. raw='${String(rawDimension ?? '')}', alias='${String(alias ?? '')}', fallback='${fallback}', dataset='${dataset}', draftPreview=${this.safePlannerDraftPreview({ ...({} as Partial<DashboardAiPlan>), dataset, dimension: typeof rawDimension === 'string' ? rawDimension : undefined })}`,
    );
    return fallback;
  }

  private resolveMetric(
    rawMetric: unknown,
    dataset: DashboardAiDataset,
    config: DatasetConfig,
  ): string {
    if (typeof rawMetric === 'string' && config.metricOrder.includes(rawMetric)) {
      return rawMetric;
    }

    const alias = this.normalizeAliasKey(rawMetric);
    const aliasesByDataset: Record<DashboardAiDataset, Record<string, string>> = {
      recaudacion: {
        total: 'totalDepositado',
        recaudacion: 'totalDepositado',
        totalrecaudacion: 'totalDepositado',
        totaldepositado: 'totalDepositado',
        depositado: 'totalDepositado',
        efectivo: 'recaudacionEfectivo',
        recaudacionefectivo: 'recaudacionEfectivo',
        facturacion: 'recaudaFact',
        recauda: 'recaudaFact',
        transitos: 'transitos',
      },
      transitos: {
        transitos: 'transitos',
        cantidad: 'transitos',
        costo: 'costoTotal',
        costototal: 'costoTotal',
        totalcosto: 'costoTotal',
      },
      facturacion: {
        total: 'totalFacturado',
        totalfacturado: 'totalFacturado',
        facturacion: 'totalFacturado',
        ventas: 'totalFacturado',
        subtotal: 'subtotal',
        iva: 'iva',
        facturas: 'facturas',
      },
    };

    const mapped = alias ? aliasesByDataset[dataset][alias] : undefined;
    if (mapped && config.metricOrder.includes(mapped)) {
      return mapped;
    }

    const fallback = config.metricOrder[0];
    this.logger.warn(
      `Planner IA metric invalida. raw='${String(rawMetric ?? '')}', alias='${String(alias ?? '')}', fallback='${fallback}', dataset='${dataset}', draftPreview=${this.safePlannerDraftPreview({ ...({} as Partial<DashboardAiPlan>), dataset, metric: typeof rawMetric === 'string' ? rawMetric : undefined })}`,
    );
    return fallback;
  }

  private normalizeAliasKey(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

    return normalized || undefined;
  }

  private normalizeLabel(value: unknown): string {
    if (value === null || value === undefined) return 'Sin dato';
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return String(value);
  }

  private normalizeDimensionLabel(dimension: string, value: unknown): string {
    if (dimension !== 'mes') {
      return this.normalizeLabel(value);
    }

    const index = this.getMonthIndex(value);
    if (index >= 1 && index <= 12) {
      return MONTH_NAMES_ES[index - 1];
    }

    return this.normalizeLabel(value);
  }

  private compareDimensionLabels(dimension: string, a: string, b: string): number {
    if (dimension === 'mes') {
      const ai = this.getMonthIndex(a);
      const bi = this.getMonthIndex(b);
      if (ai > 0 && bi > 0) {
        return ai - bi;
      }
      if (ai > 0) return -1;
      if (bi > 0) return 1;
    }

    return a.localeCompare(b);
  }

  private getMonthIndex(value: unknown): number {
    const raw = this.normalizeLabel(value).trim();
    if (!raw) return -1;

    const num = Number(raw);
    if (!Number.isNaN(num) && num >= 1 && num <= 12) {
      return num;
    }

    const upper = raw.toUpperCase();
    const idxEn = MONTH_NAMES.findIndex((m) => m.toUpperCase() === upper);
    if (idxEn >= 0) return idxEn + 1;

    const idxEs = MONTH_NAMES_ES.findIndex((m) => m.toUpperCase() === upper);
    if (idxEs >= 0) return idxEs + 1;

    const aliases: Record<string, number> = {
      ENERO: 1,
      FEBRERO: 2,
      MARZO: 3,
      ABRIL: 4,
      MAYO: 5,
      JUNIO: 6,
      JULIO: 7,
      AGOSTO: 8,
      SEPTIEMBRE: 9,
      SETIEMBRE: 9,
      OCTUBRE: 10,
      NOVIEMBRE: 11,
      DICIEMBRE: 12,
      JANUARY: 1,
      FEBRUARY: 2,
      MARCH: 3,
      APRIL: 4,
      MAY: 5,
      JUNE: 6,
      JULY: 7,
      AUGUST: 8,
      SEPTEMBER: 9,
      OCTOBER: 10,
      NOVEMBER: 11,
      DECEMBER: 12,
    };

    return aliases[upper] ?? -1;
  }

  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private capitalize(value: string): string {
    if (!value) return value;
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  }
}
