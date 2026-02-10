import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma-service/prisma-service.service';
import { RecaudacionQueryDto } from './dto/recaudacion-query.dto';

@Injectable()
export class RecaudacionService {
  constructor(private readonly prisma: PrismaService) {}

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
      conditions.push(Prisma.sql`rc.NUM_SEMANA = ${query.numSemana}`);
    }

    return {
      fromSql: Prisma.sql`FROM VW_RECAUDA_COSAD rc`,
      whereSql: conditions.length
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql``,
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
