import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma-service/prisma-service.service';
import { TransitosQueryDto } from './dto/transitos-query.dto';

@Injectable()
export class TransitosService {
  private readonly excludedObservacionCabina = [
    'OPERACION ANULADA / POR JUSTIFICACION',
    'OPERACION ANULADA /',
    'CARAVANA /',
    'OPERACION CERRADA /',
    'VIOLACION DE VIA /',
    'OPERACION ANULADA / FACTURA CON DATOS',
    'OPERACION ANULADA / FACTURA CONSUMIDOR FINAL',
  ];
  private readonly violacionObservacionCabina = 'VIOLACION DE VIA /';

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: TransitosQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const includeData = normalizedQuery.includeData === true;
    const where: Prisma.VISTA_TRANSITOSWhereInput = {
      OR: [
        { OBSERVACION_CABINA: null },
        {
          OBSERVACION_CABINA: {
            notIn: this.excludedObservacionCabina,
          },
        },
      ],
    };

    const resolveRango = (rango: string): Prisma.DateTimeFilter | undefined => {
      const now = new Date();
      const startOfDayUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      switch (rango) {
        case 'ultimos7d': {
          const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return { gte: from, lte: now };
        }
        case 'ultimos15d': {
          const from = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
          return { gte: from, lte: now };
        }
        case 'ultimos90d': {
          const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          return { gte: from, lte: now };
        }
        case 'mesActual': {
          const y = now.getUTCFullYear();
          const m = now.getUTCMonth();
          const start = startOfDayUtc(new Date(Date.UTC(y, m, 1)));
          return { gte: start, lte: now };
        }
        case 'ultimoMes': {
          const y = now.getUTCFullYear();
          const m = now.getUTCMonth();
          const startPrev = startOfDayUtc(new Date(Date.UTC(y, m - 1, 1)));
          const endPrev = startOfDayUtc(new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)));
          return { gte: startPrev, lte: endPrev };
        }
        default:
          return undefined;
      }
    };

    const buildRanges = (rango?: string) => {
      if (!rango) return { current: undefined, previous: undefined, compare: false };
      const compare = rango.endsWith('Anterior');
      const base = compare ? rango.replace('Anterior', '') : rango;
      const current = resolveRango(base);
      let previous: Prisma.DateTimeFilter | undefined;
      if (compare && current?.gte && current?.lte) {
        const gte = new Date(current.gte);
        const lte = new Date(current.lte);
        const durationMs = lte.getTime() - gte.getTime();
        if (base === 'ultimoMes') {
          const prevStart = new Date(Date.UTC(gte.getUTCFullYear(), gte.getUTCMonth() - 1, 1));
          const prevEnd = new Date(Date.UTC(gte.getUTCFullYear(), gte.getUTCMonth(), 0, 23, 59, 59, 999));
          previous = { gte: prevStart, lte: prevEnd };
        } else {
          const prevEnd = new Date(gte.getTime() - 1);
          const prevStart = new Date(prevEnd.getTime() - durationMs);
          previous = { gte: prevStart, lte: prevEnd };
        }
      }
      return { current, previous, compare };
    };

    // Si vienen filtros de fecha, mes, año, semana o rango, no aplicamos la ventana por defecto
    const hasFechaFiltro = Boolean(
      normalizedQuery.fechaInicio ||
      normalizedQuery.fechaFin ||
      normalizedQuery.mes !== undefined ||
      normalizedQuery.anio !== undefined ||
      normalizedQuery.semana !== undefined ||
      normalizedQuery.rango,
    );
    if (!hasFechaFiltro) {
      const ultimoMes = resolveRango('ultimoMes');
      if (ultimoMes) {
        where.FECHA = ultimoMes;
      }
    }

    const { current: rangoActual, previous: rangoAnterior, compare: compareMode } = buildRanges(normalizedQuery.rango);

    if (rangoActual) {
      where.FECHA = rangoActual;
    }

    if (normalizedQuery.fechaInicio || normalizedQuery.fechaFin) {
      const fechaFilter: Prisma.DateTimeFilter = {};
      if (normalizedQuery.fechaInicio) {
        fechaFilter.gte = this.parseQueryDateStart(normalizedQuery.fechaInicio);
      }
      if (normalizedQuery.fechaFin) {
        fechaFilter.lte = this.parseQueryDateEnd(normalizedQuery.fechaFin);
      }
      where.FECHA = fechaFilter;
    }

    if (normalizedQuery.peajeNombre) {
      where.PEAJE = { equals: normalizedQuery.peajeNombre };
    } else if (normalizedQuery.nombrePeaje) {
      where.PEAJE = { contains: normalizedQuery.nombrePeaje };
    } else if (normalizedQuery.idPeaje) {
      where.PEAJE = { contains: normalizedQuery.idPeaje };
    } else if (normalizedQuery.peaje) {
      where.PEAJE = { contains: normalizedQuery.peaje };
    }
    if (normalizedQuery.cabina) {
      // CABINA en vista es numérica, comparamos como número exacto si es convertible
      const cabNum = Number(normalizedQuery.cabina);
      if (!Number.isNaN(cabNum)) {
        where.CABINA = { equals: cabNum } as any;
      }
    }
    if (normalizedQuery.turno) {
      const turnoNum = Number(normalizedQuery.turno);
      if (!Number.isNaN(turnoNum)) {
        where.TURNO = { equals: turnoNum } as any;
      }
    }
    if (normalizedQuery.noFactura) {
      where.No_FACTURA = { contains: normalizedQuery.noFactura };
    }
    if (normalizedQuery.numeroParte) {
      where.NUMERO_PARTE = { contains: normalizedQuery.numeroParte };
    }
    if (normalizedQuery.nombreCajero) {
      where.NOMBRE_CAJERO = { contains: normalizedQuery.nombreCajero };
    }
    if (normalizedQuery.placa) {
      where.PLACA = { contains: normalizedQuery.placa };
    }
    if (normalizedQuery.categoria) {
      where.CATEGORIA = { contains: normalizedQuery.categoria };
    } else if (normalizedQuery.idCategoria) {
      where.CATEGORIA = { contains: normalizedQuery.idCategoria };
    }
    if (normalizedQuery.tipo1) {
      where.TIPO_1 = { contains: normalizedQuery.tipo1 };
    } else if (normalizedQuery.formaPago) {
      where.TIPO_1 = { contains: normalizedQuery.formaPago };
    }
    if (normalizedQuery.tipo2) {
      where.TIPO_2 = { contains: normalizedQuery.tipo2 };
    } else if (normalizedQuery.porcDesc) {
      where.TIPO_2 = { contains: normalizedQuery.porcDesc };
    }
    if (typeof normalizedQuery.semana === 'number') {
      where.SEMANA = { equals: normalizedQuery.semana } as any;
    }
    if (normalizedQuery.mes !== undefined) {
      // Vista devuelve mes como texto (ej. 'January'); admitimos número o nombre
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const mesStr = String(normalizedQuery.mes);
      const mesNum = Number(mesStr);
      const mesValue = !Number.isNaN(mesNum) && mesNum >= 1 && mesNum <= 12
        ? monthNames[mesNum - 1]
        : mesStr;
      where.MES = { equals: mesValue } as any;
    }
    if (normalizedQuery.anio !== undefined) {
      // ANIO es numérico; comparamos como número
      const anioNum = Number(normalizedQuery.anio);
      if (!Number.isNaN(anioNum)) {
        where.ANIO = { equals: anioNum } as any;
      }
    }

    // Default 200, tope 10000 para evitar respuestas gigantes por defecto
    const take = Math.min(normalizedQuery.take ?? 200, 50000);
    const skip = normalizedQuery.skip ?? 0;

    const orderBy: Prisma.VISTA_TRANSITOSOrderByWithRelationInput[] = [
      { FECHA: 'desc' },
      { No_FACTURA: 'desc' },
    ];

    if (!compareMode && !includeData) {
      const aggregates = await this.buildTransitosAggregatesFromDb(normalizedQuery);
      return { data: [], aggregates };
    }

    if (!compareMode) {
      const data = await this.prisma.vISTA_TRANSITOS.findMany({
        where,
        orderBy,
        skip,
        take,
      });

      return data;
    }

    const whereAnterior: Prisma.VISTA_TRANSITOSWhereInput = { ...where };
    if (rangoAnterior) {
      whereAnterior.FECHA = rangoAnterior;
    }

    const [actualData, anteriorData] = await Promise.all([
      this.prisma.vISTA_TRANSITOS.findMany({ where, orderBy, skip, take }),
      this.prisma.vISTA_TRANSITOS.findMany({ where: whereAnterior, orderBy, skip, take }),
    ]);

    const sumCosto = (rows: any[]) => rows.reduce((acc, r) => acc + Number(r.COSTO ?? 0), 0);
    const totalActual = sumCosto(actualData);
    const totalAnterior = sumCosto(anteriorData);
    const changePercent = totalAnterior === 0 ? null : ((totalActual - totalAnterior) / totalAnterior) * 100;
    const arrow = changePercent === null || changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';
    const footer = changePercent === null
      ? 'Sin datos suficientes para comparar'
      : `${arrow === 'up' ? '↗' : arrow === 'down' ? '↘' : '↔'} ${Math.abs(changePercent).toFixed(1)}% ${arrow === 'up' ? 'más' : arrow === 'down' ? 'menos' : 'igual'} que el periodo anterior`;

    return {
      actual: { data: actualData, total: totalActual },
      anterior: { data: anteriorData, total: totalAnterior },
      changePercent,
      footer,
      arrow,
    };
  }

  async findAnnualByMonth(query: TransitosQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const annualQuery: TransitosQueryDto = {
      ...normalizedQuery,
      formaPago: this.normalizeTipo1Value(normalizedQuery.formaPago),
      tipo1: this.normalizeTipo1Value(normalizedQuery.tipo1),
      fechaInicio: undefined,
      fechaFin: undefined,
      desde: undefined,
      hasta: undefined,
      rango: undefined,
      semana: undefined,
      mes: undefined,
      take: undefined,
      skip: undefined,
    };

    const monthLabelsEs = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];

    const monthCaseSql = Prisma.sql`CASE vt.MES
      WHEN 'January' THEN 1
      WHEN 'February' THEN 2
      WHEN 'March' THEN 3
      WHEN 'April' THEN 4
      WHEN 'May' THEN 5
      WHEN 'June' THEN 6
      WHEN 'July' THEN 7
      WHEN 'August' THEN 8
      WHEN 'September' THEN 9
      WHEN 'October' THEN 10
      WHEN 'November' THEN 11
      WHEN 'December' THEN 12
      ELSE NULL
    END`;

    const { fromSql, whereSql } = this.buildTemporalSqlParts(annualQuery, [], {
      applyDefaultDateWindow: false,
      applyAnnualTipo1Adjustments: true,
    });

    const monthlyRows = await this.prisma.$queryRaw<Array<{ anio: unknown; mesNumero: unknown; cantidad: unknown }>>(Prisma.sql`
        SELECT
          vt.ANIO as anio,
          ${monthCaseSql} as mesNumero,
          COUNT(*) as cantidad
        ${fromSql}
        ${whereSql}
        GROUP BY vt.ANIO, ${monthCaseSql}
        ORDER BY vt.ANIO, ${monthCaseSql}
      `);

    const yearSet = new Set<number>();
    const matrix = new Map<number, Map<number, number>>();

    monthlyRows.forEach((row) => {
      const year = this.toNumber(row.anio);
      const monthNumber = this.toNumber(row.mesNumero);
      if (year <= 0 || monthNumber < 1 || monthNumber > 12) return;

      yearSet.add(year);
      if (!matrix.has(monthNumber)) {
        matrix.set(monthNumber, new Map<number, number>());
      }

      matrix.get(monthNumber)?.set(year, this.toNumber(row.cantidad));
    });

    let years = Array.from(yearSet).sort((a, b) => a - b);
    if (normalizedQuery.anio !== undefined) {
      const requestedYear = Number(normalizedQuery.anio);
      years = Number.isFinite(requestedYear) ? [requestedYear] : years;
    }

    const totalsByYear = new Map<number, number>();
    years.forEach((year) => totalsByYear.set(year, 0));

    const rows = Array.from({ length: 12 }, (_, index) => {
      const mesNumero = index + 1;
      const valores: Record<string, number> = {};
      let totalMes = 0;

      years.forEach((year) => {
        const value = matrix.get(mesNumero)?.get(year) ?? 0;
        valores[String(year)] = value;
        totalMes += value;
        totalsByYear.set(year, (totalsByYear.get(year) ?? 0) + value);
      });

      return {
        mesNumero,
        mes: monthLabelsEs[index],
        valores,
        totalGeneral: totalMes,
      };
    });

    const totalGeneral = Array.from(totalsByYear.values()).reduce((sum, value) => sum + value, 0);
    const totalPorAnio = years.map((year) => ({
      anio: year,
      total: totalsByYear.get(year) ?? 0,
    }));

    return {
      anios: years,
      filas: rows,
      totalPorAnio,
      totalGeneral,
    };
  }

  private normalizeQuery(query: TransitosQueryDto): TransitosQueryDto {
    const normalized: TransitosQueryDto = { ...query };
    if (!normalized.fechaInicio && normalized.desde) {
      normalized.fechaInicio = normalized.desde;
    }
    if (!normalized.fechaFin && normalized.hasta) {
      normalized.fechaFin = normalized.hasta;
    }
    return normalized;
  }

  private normalizeTipo1Value(value?: string) {
    if (!value) return value;

    const normalized = value.trim().toUpperCase();
    if (normalized === 'EFECTIVO' || normalized === 'EFEC.' || normalized === 'EFEC') {
      return 'EFEC.';
    }

    return value.trim();
  }

  private getExcludedObservacionCabina(query: TransitosQueryDto) {
    const filtroTipo1 = (query.tipo1 ?? query.formaPago ?? '').trim().toUpperCase();
    if (filtroTipo1.includes('VIOLACION')) {
      return this.excludedObservacionCabina.filter(item => item !== this.violacionObservacionCabina);
    }

    return this.excludedObservacionCabina;
  }

  private hasExplicitTime(dateText: string) {
    const value = dateText.trim();
    return value.includes('T') || /\d{2}:\d{2}/.test(value);
  }

  private parseQueryDateStart(dateText: string) {
    if (this.hasExplicitTime(dateText)) {
      return new Date(dateText);
    }

    const [year, month, day] = dateText.split('T')[0].split('-').map(Number);
    if ([year, month, day].some((part) => Number.isNaN(part))) {
      return new Date(dateText);
    }

    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  private parseQueryDateEnd(dateText: string) {
    if (this.hasExplicitTime(dateText)) {
      return new Date(dateText);
    }

    const [year, month, day] = dateText.split('T')[0].split('-').map(Number);
    if ([year, month, day].some((part) => Number.isNaN(part))) {
      return new Date(dateText);
    }

    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }

  private buildTemporalSqlParts(
    query: TransitosQueryDto,
    extras: Prisma.Sql[] = [],
    options: { applyDefaultDateWindow?: boolean; applyAnnualTipo1Adjustments?: boolean } = {},
  ) {
    const conditions: Prisma.Sql[] = [];
    const { applyDefaultDateWindow = true, applyAnnualTipo1Adjustments = false } = options;
    const effectiveQuery = applyAnnualTipo1Adjustments
      ? {
          ...query,
          formaPago: this.normalizeTipo1Value(query.formaPago),
          tipo1: this.normalizeTipo1Value(query.tipo1),
        }
      : query;
    const excludedObservacionCabina = applyAnnualTipo1Adjustments
      ? this.getExcludedObservacionCabina(effectiveQuery)
      : this.excludedObservacionCabina;

    conditions.push(
      Prisma.sql`(vt.OBSERVACION_CABINA IS NULL OR vt.OBSERVACION_CABINA NOT IN (${Prisma.join(excludedObservacionCabina)}))`,
    );

    const resolveRango = (rango: string): Prisma.DateTimeFilter | undefined => {
      const now = new Date();
      const startOfDayUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      switch (rango) {
        case 'ultimos7d': {
          const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return { gte: from, lte: now };
        }
        case 'ultimos15d': {
          const from = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
          return { gte: from, lte: now };
        }
        case 'ultimos90d': {
          const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          return { gte: from, lte: now };
        }
        case 'mesActual': {
          const y = now.getUTCFullYear();
          const m = now.getUTCMonth();
          const start = startOfDayUtc(new Date(Date.UTC(y, m, 1)));
          return { gte: start, lte: now };
        }
        case 'ultimoMes': {
          const y = now.getUTCFullYear();
          const m = now.getUTCMonth();
          const startPrev = startOfDayUtc(new Date(Date.UTC(y, m - 1, 1)));
          const endPrev = startOfDayUtc(new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)));
          return { gte: startPrev, lte: endPrev };
        }
        default:
          return undefined;
      }
    };

    const buildRanges = (rango?: string) => {
      if (!rango) return { current: undefined };
      const compare = rango.endsWith('Anterior');
      const base = compare ? rango.replace('Anterior', '') : rango;
      const current = resolveRango(base);
      return { current };
    };

    const hasFechaFiltro = Boolean(
      effectiveQuery.fechaInicio ||
      effectiveQuery.fechaFin ||
      effectiveQuery.mes !== undefined ||
      effectiveQuery.anio !== undefined ||
      effectiveQuery.semana !== undefined ||
      effectiveQuery.rango,
    );
    if (applyDefaultDateWindow && !hasFechaFiltro) {
      const ultimoMes = resolveRango('ultimoMes');
      if (ultimoMes?.gte) {
        conditions.push(Prisma.sql`vt.FECHA >= ${ultimoMes.gte}`);
      }
      if (ultimoMes?.lte) {
        conditions.push(Prisma.sql`vt.FECHA <= ${ultimoMes.lte}`);
      }
    }

    const { current: rangoActual } = buildRanges(effectiveQuery.rango);
    if (rangoActual?.gte) {
      conditions.push(Prisma.sql`vt.FECHA >= ${rangoActual.gte}`);
    }
    if (rangoActual?.lte) {
      conditions.push(Prisma.sql`vt.FECHA <= ${rangoActual.lte}`);
    }

    if (effectiveQuery.fechaInicio || effectiveQuery.fechaFin) {
      if (effectiveQuery.fechaInicio) {
        conditions.push(Prisma.sql`vt.FECHA >= ${this.parseQueryDateStart(effectiveQuery.fechaInicio)}`);
      }
      if (effectiveQuery.fechaFin) {
        conditions.push(Prisma.sql`vt.FECHA <= ${this.parseQueryDateEnd(effectiveQuery.fechaFin)}`);
      }
    }

    if (effectiveQuery.peajeNombre) {
      conditions.push(Prisma.sql`vt.PEAJE = ${effectiveQuery.peajeNombre}`);
    } else if (effectiveQuery.nombrePeaje) {
      conditions.push(Prisma.sql`vt.PEAJE LIKE ${'%' + effectiveQuery.nombrePeaje + '%'}`);
    } else if (effectiveQuery.idPeaje) {
      conditions.push(Prisma.sql`vt.PEAJE LIKE ${'%' + effectiveQuery.idPeaje + '%'}`);
    } else if (effectiveQuery.peaje) {
      conditions.push(Prisma.sql`vt.PEAJE LIKE ${'%' + effectiveQuery.peaje + '%'}`);
    }

    if (effectiveQuery.cabina) {
      const cabNum = Number(effectiveQuery.cabina);
      if (!Number.isNaN(cabNum)) {
        conditions.push(Prisma.sql`vt.CABINA = ${cabNum}`);
      }
    }
    if (effectiveQuery.turno) {
      const turnoNum = Number(effectiveQuery.turno);
      if (!Number.isNaN(turnoNum)) {
        conditions.push(Prisma.sql`vt.TURNO = ${turnoNum}`);
      }
    }
    if (effectiveQuery.noFactura) {
      conditions.push(Prisma.sql`vt.No_FACTURA LIKE ${'%' + effectiveQuery.noFactura + '%'}`);
    }
    if (effectiveQuery.numeroParte) {
      conditions.push(Prisma.sql`vt.NUMERO_PARTE LIKE ${'%' + effectiveQuery.numeroParte + '%'}`);
    }
    if (effectiveQuery.nombreCajero) {
      conditions.push(Prisma.sql`vt.NOMBRE_CAJERO LIKE ${'%' + effectiveQuery.nombreCajero + '%'}`);
    }
    if (effectiveQuery.placa) {
      conditions.push(Prisma.sql`vt.PLACA LIKE ${'%' + effectiveQuery.placa + '%'}`);
    }
    if (effectiveQuery.categoria) {
      conditions.push(Prisma.sql`vt.CATEGORIA LIKE ${'%' + effectiveQuery.categoria + '%'}`);
    } else if (effectiveQuery.idCategoria) {
      conditions.push(Prisma.sql`vt.CATEGORIA LIKE ${'%' + effectiveQuery.idCategoria + '%'}`);
    }
    if (effectiveQuery.tipo1) {
      conditions.push(Prisma.sql`vt.TIPO_1 LIKE ${'%' + effectiveQuery.tipo1 + '%'}`);
    } else if (effectiveQuery.formaPago) {
      conditions.push(Prisma.sql`vt.TIPO_1 LIKE ${'%' + effectiveQuery.formaPago + '%'}`);
    }
    if (effectiveQuery.tipo2) {
      conditions.push(Prisma.sql`vt.TIPO_2 LIKE ${'%' + effectiveQuery.tipo2 + '%'}`);
    } else if (effectiveQuery.porcDesc) {
      conditions.push(Prisma.sql`vt.TIPO_2 LIKE ${'%' + effectiveQuery.porcDesc + '%'}`);
    }
    if (typeof effectiveQuery.semana === 'number') {
      conditions.push(Prisma.sql`vt.SEMANA = ${effectiveQuery.semana}`);
    }
    if (typeof effectiveQuery.mes === 'number') {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const mesValue = monthNames[effectiveQuery.mes - 1];
      if (mesValue) {
        conditions.push(Prisma.sql`vt.MES = ${mesValue}`);
      }
    }
    if (typeof effectiveQuery.anio === 'number') {
      conditions.push(Prisma.sql`vt.ANIO = ${effectiveQuery.anio}`);
    }

    const allConditions = [...conditions, ...extras];
    return {
      fromSql: Prisma.sql`FROM VISTA_TRANSITOS vt`,
      whereSql: allConditions.length
        ? Prisma.sql`WHERE ${Prisma.join(allConditions, ' AND ')}`
        : Prisma.sql``,
    };
  }

  private formatHourLabel(hour: number) {
    const hh = String(Math.max(0, Math.min(23, hour))).padStart(2, '0');
    return `${hh}:00`;
  }

  private toNumber(value: unknown) {
    if (value === null || value === undefined) return 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private async buildTransitosAggregatesFromDb(query: TransitosQueryDto) {
    const horaExpr = Prisma.sql`CAST(LEFT(vt.HORA, 2) as int)`;
    const { fromSql, whereSql } = this.buildTemporalSqlParts(query);
    const { whereSql: whereHourSql } = this.buildTemporalSqlParts(query, [
      Prisma.sql`vt.HORA IS NOT NULL`,
      Prisma.sql`LEN(vt.HORA) >= 2`,
      Prisma.sql`ISNUMERIC(LEFT(vt.HORA, 2)) = 1`,
    ]);

    const [hourlyRows, hourlyByDayRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ hora: unknown; cantidad: unknown }>>(Prisma.sql`
      SELECT
        ${horaExpr} as hora,
        COUNT(*) as cantidad
      ${fromSql}
      ${whereHourSql}
      GROUP BY ${horaExpr}
      ORDER BY ${horaExpr}
    `),
      this.prisma.$queryRaw<Array<{ fecha: unknown; hora: unknown; cantidad: unknown }>>(Prisma.sql`
      SELECT
        CAST(vt.FECHA as date) as fecha,
        ${horaExpr} as hora,
        COUNT(*) as cantidad
      ${fromSql}
      ${whereHourSql}
      GROUP BY CAST(vt.FECHA as date), ${horaExpr}
      ORDER BY CAST(vt.FECHA as date), ${horaExpr}
    `),
    ]);

    const porHoraMap = new Map<number, number>();
    for (let hour = 0; hour < 24; hour += 1) {
      porHoraMap.set(hour, 0);
    }
    hourlyRows.forEach(row => {
      const hour = this.toNumber(row.hora);
      if (hour >= 0 && hour <= 23) {
        porHoraMap.set(hour, this.toNumber(row.cantidad));
      }
    });

    const porHora = Array.from(porHoraMap.entries()).map(([hour, cantidad]) => ({
      hora: this.formatHourLabel(hour),
      cantidad,
    }));

    const totalTransitos = porHora.reduce((sum, row) => sum + row.cantidad, 0);

    const byDateMap = new Map<string, Map<number, number>>();
    hourlyByDayRows.forEach(row => {
      const date = row.fecha instanceof Date
        ? row.fecha.toISOString().slice(0, 10)
        : new Date(String(row.fecha)).toISOString().slice(0, 10);
      if (!byDateMap.has(date)) {
        const hoursMap = new Map<number, number>();
        for (let hour = 0; hour < 24; hour += 1) {
          hoursMap.set(hour, 0);
        }
        byDateMap.set(date, hoursMap);
      }
      const hoursMap = byDateMap.get(date);
      if (!hoursMap) return;
      const hour = this.toNumber(row.hora);
      if (hour >= 0 && hour <= 23) {
        hoursMap.set(hour, this.toNumber(row.cantidad));
      }
    });

    const porHoraDia = Array.from(byDateMap.entries()).map(([fecha, hoursMap]) => ({
      fecha,
      horas: Array.from(hoursMap.entries()).map(([hour, cantidad]) => ({
        hora: this.formatHourLabel(hour),
        cantidad,
      })),
    }));

    return {
      totalTransitos,
      porHora,
      porHoraDia,
    };
  }
}
