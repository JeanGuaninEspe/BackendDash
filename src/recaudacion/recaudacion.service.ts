import { Injectable, RequestTimeoutException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma-service/prisma-service.service';
import { RecaudacionQueryDto } from './dto/recaudacion-query.dto';

@Injectable()
export class RecaudacionService {
  constructor(private readonly prisma: PrismaService) {}

  async findAnnual(query: RecaudacionQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const timeoutMs = normalizedQuery.timeoutMs ?? 45000;
    const annualQuery: RecaudacionQueryDto = {
      ...normalizedQuery,
      take: undefined,
      skip: undefined,
      rango: undefined,
    };

    const monthCaseSql = Prisma.sql`CASE rc.MES
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

    const metric = this.resolveAnnualMetric(annualQuery.tipoMonto);
    const { fromSql, whereSql } = this.buildAnnualRecaudacionSqlParts(annualQuery);

    const [monthlyRows, weeklyRows] = await this.withQueryTimeout(
      () => Promise.all([
        this.prisma.$queryRaw<Array<{ anio: unknown; mesNumero: unknown; total: unknown }>>(Prisma.sql`
          SELECT
            rc.[YEAR] as anio,
            ${monthCaseSql} as mesNumero,
            SUM(${metric.expression}) as total
          ${fromSql}
          ${whereSql}
          GROUP BY rc.[YEAR], ${monthCaseSql}
          ORDER BY rc.[YEAR], ${monthCaseSql}
        `),
        this.prisma.$queryRaw<Array<{ anio: unknown; semana: unknown; total: unknown }>>(Prisma.sql`
          SELECT
            rc.[YEAR] as anio,
            DATEPART(ISO_WEEK, rc.FECHA_HORARIO) as semana,
            SUM(${metric.expression}) as total
          ${fromSql}
          ${whereSql}
          GROUP BY rc.[YEAR], DATEPART(ISO_WEEK, rc.FECHA_HORARIO)
          ORDER BY rc.[YEAR], DATEPART(ISO_WEEK, rc.FECHA_HORARIO)
        `),
      ]),
      timeoutMs,
      'La consulta anual de recaudación excedió el tiempo de espera. Ajusta filtros e intenta de nuevo.',
    );

    const monthLabelsEs = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];

    const yearSet = new Set<number>();
    const monthMatrix = new Map<number, Map<number, number>>();
    monthlyRows.forEach((row) => {
      const year = this.toNumber(row.anio);
      const month = this.toNumber(row.mesNumero);
      if (year <= 0 || month < 1 || month > 12) return;
      yearSet.add(year);
      if (!monthMatrix.has(month)) monthMatrix.set(month, new Map<number, number>());
      monthMatrix.get(month)?.set(year, this.toNumber(row.total));
    });

    const weekMatrix = new Map<number, Map<number, number>>();
    weeklyRows.forEach((row) => {
      const year = this.toNumber(row.anio);
      const week = this.toNumber(row.semana);
      if (year <= 0 || week < 1 || week > 53) return;
      yearSet.add(year);
      if (!weekMatrix.has(week)) weekMatrix.set(week, new Map<number, number>());
      weekMatrix.get(week)?.set(year, this.toNumber(row.total));
    });

    let years = Array.from(yearSet).sort((a, b) => a - b);
    if (typeof annualQuery.anio === 'number') {
      years = [annualQuery.anio];
    }

    const totalsByYear = new Map<number, number>();
    years.forEach((year) => totalsByYear.set(year, 0));

    const filas = Array.from({ length: 12 }, (_, index) => {
      const mesNumero = index + 1;
      const valores: Record<string, number> = {};
      let totalGeneral = 0;
      years.forEach((year) => {
        const value = monthMatrix.get(mesNumero)?.get(year) ?? 0;
        valores[String(year)] = value;
        totalGeneral += value;
        totalsByYear.set(year, (totalsByYear.get(year) ?? 0) + value);
      });
      return { mesNumero, mes: monthLabelsEs[index], valores, totalGeneral };
    });

    const filasSemanales = Array.from({ length: 53 }, (_, index) => {
      const semana = index + 1;
      const valores: Record<string, number> = {};
      let totalGeneral = 0;
      years.forEach((year) => {
        const value = weekMatrix.get(semana)?.get(year) ?? 0;
        valores[String(year)] = value;
        totalGeneral += value;
      });
      return { semana, valores, totalGeneral };
    });

    const totalPorAnio = years.map((year) => ({
      anio: year,
      total: totalsByYear.get(year) ?? 0,
    }));
    const totalGeneral = totalPorAnio.reduce((sum, row) => sum + row.total, 0);

    return {
      metrica: metric.key,
      filtrosAplicados: {
        anio: annualQuery.anio ?? null,
        nombrePeaje: annualQuery.nombrePeaje ?? null,
        turno: annualQuery.turno ?? null,
        mes: annualQuery.mes ?? null,
        numSemana: annualQuery.numSemana ?? null,
        fechaInicio: annualQuery.fechaInicio ?? null,
        fechaFin: annualQuery.fechaFin ?? null,
      },
      anios: years,
      filas,
      filasSemanales,
      totalPorAnio,
      totalGeneral,
    };
  }

  async findDailyReportByPeajes(query: RecaudacionQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const turnosIncluidos = normalizedQuery.turno !== undefined
      ? [Number(normalizedQuery.turno)]
      : [1, 2, 3];
    const { fromSql, whereSql } = this.buildDailyReportSqlParts(normalizedQuery);

    const rows = await this.prisma.$queryRaw<Array<{
      fecha: unknown;
      nombrePeaje: string | null;
      recaudacionEfectivo: unknown;
      recargasRfid: unknown;
      sobrante: unknown;
      notasCredito: unknown;
      totalEfectivo: unknown;
      recaudaCheque: unknown;
      reposicion: unknown;
      recaudaFact: unknown;
      recEfecRfid: unknown;
      totalDepositado: unknown;
      faltante: unknown;
    }>>(Prisma.sql`
      SELECT
        CAST(rc.FECHA_HORARIO as date) as fecha,
        rc.NOMBRE_PEAJE as nombrePeaje,
        SUM(COALESCE(rc.RECAUDA_EFECTIVO, 0)) as recaudacionEfectivo,
        SUM(COALESCE(rc.RECARGAS_RFID, 0)) as recargasRfid,
        SUM(COALESCE(rc.SOBRANTE, 0)) as sobrante,
        SUM(COALESCE(rc.NC, 0)) as notasCredito,
        SUM(COALESCE(rc.EFECTIVO, 0)) as totalEfectivo,
        SUM(COALESCE(rc.RECAUDA_CHEQUE, 0)) as recaudaCheque,
        SUM(COALESCE(rc.REPOSICION, 0)) as reposicion,
        SUM(COALESCE(rc.RECAUDA_FACT, 0)) as recaudaFact,
        SUM(COALESCE(rc.REC_EFEC_RFID, 0)) as recEfecRfid,
        SUM(COALESCE(rc.TOTAL_DEPOSITADO, 0)) as totalDepositado,
        SUM(COALESCE(rc.FALTANTE, 0)) as faltante
      ${fromSql}
      ${whereSql}
      GROUP BY CAST(rc.FECHA_HORARIO as date), rc.NOMBRE_PEAJE
      ORDER BY rc.NOMBRE_PEAJE, CAST(rc.FECHA_HORARIO as date)
    `);

    const data = rows.map((row) => ({
      fecha: this.formatIsoDate(row.fecha),
      nombrePeaje: (row.nombrePeaje ?? '').toString(),
      recaudacionEfectivo: this.toNumber(row.recaudacionEfectivo),
      recargasRfid: this.toNumber(row.recargasRfid),
      sobrante: this.toNumber(row.sobrante),
      notasCredito: this.toNumber(row.notasCredito),
      totalEfectivo: this.toNumber(row.totalEfectivo),
      recaudaCheque: this.toNumber(row.recaudaCheque),
      reposicion: this.toNumber(row.reposicion),
      recaudaFact: this.toNumber(row.recaudaFact),
      recEfecRfid: this.toNumber(row.recEfecRfid),
      totalDepositado: this.toNumber(row.totalDepositado),
      faltante: this.toNumber(row.faltante),
    }));

    type TotalesReporte = {
      recaudacionEfectivo: number;
      recargasRfid: number;
      sobrante: number;
      notasCredito: number;
      totalEfectivo: number;
      recaudaCheque: number;
      reposicion: number;
      recaudaFact: number;
      recEfecRfid: number;
      totalDepositado: number;
      faltante: number;
    };

    const initTotales = (): TotalesReporte => ({
      recaudacionEfectivo: 0,
      recargasRfid: 0,
      sobrante: 0,
      notasCredito: 0,
      totalEfectivo: 0,
      recaudaCheque: 0,
      reposicion: 0,
      recaudaFact: 0,
      recEfecRfid: 0,
      totalDepositado: 0,
      faltante: 0,
    });

    const sumInto = (acc: TotalesReporte, item: TotalesReporte) => {
      acc.recaudacionEfectivo += item.recaudacionEfectivo;
      acc.recargasRfid += item.recargasRfid;
      acc.sobrante += item.sobrante;
      acc.notasCredito += item.notasCredito;
      acc.totalEfectivo += item.totalEfectivo;
      acc.recaudaCheque += item.recaudaCheque;
      acc.reposicion += item.reposicion;
      acc.recaudaFact += item.recaudaFact;
      acc.recEfecRfid += item.recEfecRfid;
      acc.totalDepositado += item.totalDepositado;
      acc.faltante += item.faltante;
    };

    const totalsByPeajeMap = new Map<string, TotalesReporte>();
    const totalGeneral = initTotales();

    data.forEach((row) => {
      const peaje = row.nombrePeaje || 'SIN_PEAJE';
      if (!totalsByPeajeMap.has(peaje)) {
        totalsByPeajeMap.set(peaje, initTotales());
      }

      const rowTotals: TotalesReporte = {
        recaudacionEfectivo: row.recaudacionEfectivo,
        recargasRfid: row.recargasRfid,
        sobrante: row.sobrante,
        notasCredito: row.notasCredito,
        totalEfectivo: row.totalEfectivo,
        recaudaCheque: row.recaudaCheque,
        reposicion: row.reposicion,
        recaudaFact: row.recaudaFact,
        recEfecRfid: row.recEfecRfid,
        totalDepositado: row.totalDepositado,
        faltante: row.faltante,
      };

      sumInto(totalsByPeajeMap.get(peaje)!, rowTotals);
      sumInto(totalGeneral, rowTotals);
    });

    const totalPorPeaje = Array.from(totalsByPeajeMap.entries()).map(([nombrePeaje, totals]) => ({
      nombrePeaje,
      ...totals,
    }));

    return {
      filtrosAplicados: {
        anio: normalizedQuery.anio ?? null,
        numSemana: normalizedQuery.numSemana ?? null,
        nombrePeaje: normalizedQuery.nombrePeaje ?? null,
        fechaInicio: normalizedQuery.fechaInicio ?? null,
        fechaFin: normalizedQuery.fechaFin ?? null,
        rango: normalizedQuery.rango ?? null,
        turnosIncluidos,
      },
      data,
      totalPorPeaje,
      totalGeneral,
    };
  }

  async findAll(query: RecaudacionQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const includeData = normalizedQuery.includeData === true;
    const where: Prisma.VW_RECAUDA_COSADWhereInput = {};

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

    const hasFechaFiltro = Boolean(
      normalizedQuery.fechaInicio ||
      normalizedQuery.fechaFin ||
      normalizedQuery.mes !== undefined ||
      normalizedQuery.anio !== undefined ||
      normalizedQuery.numSemana !== undefined ||
      normalizedQuery.rango,
    );
    if (!hasFechaFiltro) {
      const ultimoMes = resolveRango('ultimoMes');
      if (ultimoMes) {
        where.FECHA_HORARIO = ultimoMes;
      }
    }

    const { current: rangoActual, previous: rangoAnterior, compare: compareMode } = buildRanges(normalizedQuery.rango);

    if (rangoActual) {
      where.FECHA_HORARIO = rangoActual;
    }

    if (normalizedQuery.fechaInicio || normalizedQuery.fechaFin) {
      const fechaFilter: Prisma.DateTimeFilter = {};
      if (normalizedQuery.fechaInicio) {
        fechaFilter.gte = new Date(normalizedQuery.fechaInicio);
      }
      if (normalizedQuery.fechaFin) {
        fechaFilter.lte = new Date(normalizedQuery.fechaFin);
      }
      where.FECHA_HORARIO = fechaFilter;
    }

    if (normalizedQuery.nombrePeaje) {
      where.NOMBRE_PEAJE = { contains: normalizedQuery.nombrePeaje };
    }

    if (normalizedQuery.turno !== undefined) {
      const turnoValue = Number(normalizedQuery.turno);
      where.TURNO = { equals: turnoValue } as any;
    }

    if (normalizedQuery.mes !== undefined) {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const mesStr = String(normalizedQuery.mes);
      const mesNum = Number(mesStr);
      const mesValue = !Number.isNaN(mesNum) && mesNum >= 1 && mesNum <= 12
        ? monthNames[mesNum - 1]
        : mesStr;
      where.mes = { equals: mesValue } as any;
    }

    if (typeof normalizedQuery.anio === 'number') {
      where.YEAR = { equals: normalizedQuery.anio } as any;
    }

    if (typeof normalizedQuery.numSemana === 'number') {
      where.NUM_SEMANA = { equals: normalizedQuery.numSemana } as any;
    }

    const take = Math.min(normalizedQuery.take ?? 200, 10000);
    const skip = normalizedQuery.skip ?? 0;

    const orderBy: Prisma.VW_RECAUDA_COSADOrderByWithRelationInput[] = [
      { FECHA_HORARIO: 'desc' },
    ];

    if (!compareMode && !includeData) {
      const aggregates = await this.buildRecaudacionAggregatesFromDb(normalizedQuery);
      return { data: [], aggregates };
    }

    if (!compareMode) {
      const data = await this.prisma.vW_RECAUDA_COSAD.findMany({
        where,
        orderBy,
        skip,
        take,
      });
      return data;
    }

    if (compareMode && !includeData) {
      const aggregates = await this.buildRecaudacionAggregatesFromDb(normalizedQuery);
      return { data: [], aggregates };
    }

    const whereAnterior: Prisma.VW_RECAUDA_COSADWhereInput = { ...where };
    if (rangoAnterior) {
      whereAnterior.FECHA_HORARIO = rangoAnterior;
    }

    const [actualData, anteriorData] = await Promise.all([
      this.prisma.vW_RECAUDA_COSAD.findMany({ where, orderBy, skip, take }),
      this.prisma.vW_RECAUDA_COSAD.findMany({ where: whereAnterior, orderBy, skip, take }),
    ]);

    const sumTotal = (rows: any[]) =>
      rows.reduce((acc, r) => acc + Number(r.TOTAL_DEPOSITADO ?? 0), 0);

    const totalActual = sumTotal(actualData);
    const totalAnterior = sumTotal(anteriorData);
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

  private toNumber(value: unknown) {
    if (value === null || value === undefined) return 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private normalizeQuery(query: RecaudacionQueryDto): RecaudacionQueryDto {
    const normalized: RecaudacionQueryDto = { ...query };
    if (!normalized.fechaInicio && normalized.desde) {
      normalized.fechaInicio = normalized.desde;
    }
    if (!normalized.fechaFin && normalized.hasta) {
      normalized.fechaFin = normalized.hasta;
    }
    return normalized;
  }

  private formatIsoDate(value: unknown) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  private buildRecaudacionDateFilter(
    query: RecaudacionQueryDto,
    overrideRange?: Prisma.DateTimeFilter,
  ) {
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

    if (overrideRange) return overrideRange;

    if (query.fechaInicio || query.fechaFin) {
      const fechaFilter: Prisma.DateTimeFilter = {};
      if (query.fechaInicio) fechaFilter.gte = new Date(query.fechaInicio);
      if (query.fechaFin) fechaFilter.lte = new Date(query.fechaFin);
      return fechaFilter;
    }

    if (query.rango) {
      return resolveRango(query.rango.replace('Anterior', ''));
    }

    const defaultRange = resolveRango('ultimoMes');
    return defaultRange;
  }

  private buildRecaudacionSqlParts(
    query: RecaudacionQueryDto,
    overrideRange?: Prisma.DateTimeFilter,
  ) {
    const conditions: Prisma.Sql[] = [];

    const fechaFilter = this.buildRecaudacionDateFilter(query, overrideRange);
    if (fechaFilter?.gte) {
      conditions.push(Prisma.sql`rc.FECHA_HORARIO >= ${fechaFilter.gte}`);
    }
    if (fechaFilter?.lte) {
      conditions.push(Prisma.sql`rc.FECHA_HORARIO <= ${fechaFilter.lte}`);
    }

    if (query.nombrePeaje) {
      conditions.push(Prisma.sql`rc.NOMBRE_PEAJE LIKE ${'%' + query.nombrePeaje + '%'}`);
    }
    if (query.turno !== undefined) {
      conditions.push(Prisma.sql`rc.TURNO = ${Number(query.turno)}`);
    }
    if (query.mes !== undefined) {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const mesValue = monthNames[Number(query.mes) - 1];
      if (mesValue) {
        conditions.push(Prisma.sql`rc.mes = ${mesValue}`);
      }
    }
    if (typeof query.anio === 'number') {
      conditions.push(Prisma.sql`rc.YEAR = ${query.anio}`);
    }
    if (typeof query.numSemana === 'number') {
      conditions.push(Prisma.sql`DATEPART(ISO_WEEK, rc.FECHA_HORARIO) = ${query.numSemana}`);
    }

    return {
      fromSql: Prisma.sql`FROM VW_RECAUDA_COSAD rc`,
      whereSql: conditions.length
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql``,
    };
  }

  private buildAnnualRecaudacionSqlParts(query: RecaudacionQueryDto) {
    const conditions: Prisma.Sql[] = [];

    if (query.fechaInicio) {
      conditions.push(Prisma.sql`rc.FECHA_HORARIO >= ${new Date(query.fechaInicio)}`);
    }
    if (query.fechaFin) {
      conditions.push(Prisma.sql`rc.FECHA_HORARIO <= ${new Date(query.fechaFin)}`);
    }
    if (query.nombrePeaje) {
      conditions.push(Prisma.sql`rc.NOMBRE_PEAJE LIKE ${'%' + query.nombrePeaje + '%'}`);
    }
    if (query.turno !== undefined) {
      conditions.push(Prisma.sql`rc.TURNO = ${Number(query.turno)}`);
    }
    if (query.mes !== undefined) {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const mesValue = monthNames[Number(query.mes) - 1];
      if (mesValue) {
        conditions.push(Prisma.sql`rc.MES = ${mesValue}`);
      }
    }
    if (typeof query.anio === 'number') {
      conditions.push(Prisma.sql`rc.[YEAR] = ${query.anio}`);
    }
    if (typeof query.numSemana === 'number') {
      conditions.push(Prisma.sql`DATEPART(ISO_WEEK, rc.FECHA_HORARIO) = ${query.numSemana}`);
    }

    return {
      fromSql: Prisma.sql`FROM VW_RECAUDA_COSAD rc`,
      whereSql: conditions.length
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql``,
    };
  }

  private resolveAnnualMetric(tipoMonto?: RecaudacionQueryDto['tipoMonto']) {
    switch (tipoMonto) {
      case 'efectivo':
        return {
          key: 'efectivo' as const,
          expression: Prisma.sql`COALESCE(rc.RECAUDA_EFECTIVO, 0)`,
        };
      case 'recargasTag':
        return {
          key: 'recargasTag' as const,
          expression: Prisma.sql`COALESCE(rc.RECARGAS_RFID, 0)`,
        };
      default:
        return {
          key: 'totalDepositado' as const,
          expression: Prisma.sql`COALESCE(rc.TOTAL_DEPOSITADO, 0)`,
        };
    }
  }

  private async withQueryTimeout<T>(
    queryExecutor: () => Promise<T>,
    timeoutMs: number,
    message = 'La consulta excedió el tiempo de espera.',
  ) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        queryExecutor(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new RequestTimeoutException(message));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private buildDailyReportSqlParts(query: RecaudacionQueryDto) {
    const conditions: Prisma.Sql[] = [];

    if (query.turno !== undefined) {
      conditions.push(Prisma.sql`rc.TURNO = ${Number(query.turno)}`);
    } else {
      conditions.push(Prisma.sql`rc.TURNO IN (1, 2, 3)`);
    }

    const hasExplicitCalendarFilter =
      typeof query.anio === 'number' ||
      typeof query.numSemana === 'number' ||
      typeof query.mes === 'number';

    const shouldApplyDefaultDateWindow =
      Boolean(query.fechaInicio || query.fechaFin || query.rango) || !hasExplicitCalendarFilter;

    const fechaFilter = shouldApplyDefaultDateWindow
      ? this.buildRecaudacionDateFilter(query)
      : undefined;

    if (fechaFilter?.gte) {
      conditions.push(Prisma.sql`rc.FECHA_HORARIO >= ${fechaFilter.gte}`);
    }
    if (fechaFilter?.lte) {
      conditions.push(Prisma.sql`rc.FECHA_HORARIO <= ${fechaFilter.lte}`);
    }

    if (query.nombrePeaje) {
      conditions.push(Prisma.sql`rc.NOMBRE_PEAJE LIKE ${'%' + query.nombrePeaje + '%'}`);
    }
    if (typeof query.anio === 'number') {
      conditions.push(Prisma.sql`rc.YEAR = ${query.anio}`);
    }
    if (typeof query.numSemana === 'number') {
      conditions.push(Prisma.sql`DATEPART(ISO_WEEK, rc.FECHA_HORARIO) = ${query.numSemana}`);
    }
    if (query.mes !== undefined) {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const mesValue = monthNames[Number(query.mes) - 1];
      if (mesValue) {
        conditions.push(Prisma.sql`rc.mes = ${mesValue}`);
      }
    }

    return {
      fromSql: Prisma.sql`FROM VW_RECAUDA_COSAD rc`,
      whereSql: Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`,
    };
  }

  private async buildRecaudacionAggregatesFromDb(query: RecaudacionQueryDto) {
    const baseWhere = this.buildRecaudacionSqlParts(query);
    const rows = await this.prisma.$queryRaw<
      Array<{ fecha: unknown; peaje: string | null; total: unknown }>
    >(Prisma.sql`
      SELECT
        CAST(rc.FECHA_HORARIO as date) as fecha,
        rc.NOMBRE_PEAJE as peaje,
        SUM(COALESCE(rc.TOTAL_DEPOSITADO,0)) as total
      ${baseWhere.fromSql}
      ${baseWhere.whereSql}
      GROUP BY CAST(rc.FECHA_HORARIO as date), rc.NOMBRE_PEAJE
      ORDER BY CAST(rc.FECHA_HORARIO as date)
    `);

    const totalsByDate = new Map<string, { congoma: number; losAngeles: number }>();
    const totalsByPeaje = { congoma: 0, losAngeles: 0 };

    rows.forEach(row => {
      const fecha = this.formatIsoDate(row.fecha);
      if (!fecha) return;
      const peajeName = (row.peaje ?? '').toString().toUpperCase();
      const total = this.toNumber(row.total);
      if (!totalsByDate.has(fecha)) {
        totalsByDate.set(fecha, { congoma: 0, losAngeles: 0 });
      }
      const entry = totalsByDate.get(fecha);
      if (!entry) return;
      if (peajeName === 'CONGOMA') {
        entry.congoma += total;
        totalsByPeaje.congoma += total;
      } else if (peajeName === 'LOS ANGELES') {
        entry.losAngeles += total;
        totalsByPeaje.losAngeles += total;
      }
    });

    const totalesPorDia = Array.from(totalsByDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, values]) => ({
        fecha,
        congoma: values.congoma,
        losAngeles: values.losAngeles,
      }));

    const totalGeneral = totalsByPeaje.congoma + totalsByPeaje.losAngeles;

    let changePercent: number | null = null;
    let arrow: 'up' | 'down' | 'flat' = 'flat';
    let footer = 'Sin datos suficientes para comparar';

    if (query.rango?.endsWith('Anterior')) {
      const base = query.rango.replace('Anterior', '');
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

      const current = resolveRango(base);
      let previous: Prisma.DateTimeFilter | undefined;
      if (current?.gte && current?.lte) {
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

      if (previous) {
        const prevWhere = this.buildRecaudacionSqlParts(query, previous);
        const prevTotals = await this.prisma.$queryRaw<
          Array<{ total: unknown }>
        >(Prisma.sql`
          SELECT SUM(COALESCE(rc.TOTAL_DEPOSITADO,0)) as total
          ${prevWhere.fromSql}
          ${prevWhere.whereSql}
        `);
        const totalAnterior = this.toNumber(prevTotals[0]?.total);
        if (totalAnterior !== 0) {
          changePercent = ((totalGeneral - totalAnterior) / totalAnterior) * 100;
          arrow = changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';
          footer = `${arrow === 'up' ? '↗' : arrow === 'down' ? '↘' : '↔'} ${Math.abs(changePercent).toFixed(1)}% ${arrow === 'up' ? 'más' : arrow === 'down' ? 'menos' : 'igual'} que el periodo anterior`;
        }
      }
    }

    return {
      totalesPorDia,
      totalPeriodo: totalsByPeaje,
      totalGeneral,
      changePercent,
      arrow,
      footer,
    };
  }
}
