import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma-service/prisma-service.service';
import { VentasTagQueryDto } from './dto/ventas-tag-query.dto';

@Injectable()
export class VentasTagService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: VentasTagQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const includeData = normalizedQuery.includeData === true;
    const where: Prisma.VW_VENTAS_TAGWhereInput = {};

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

    if (typeof normalizedQuery.idConcesion === 'number') {
      where.ID_CONCESION = normalizedQuery.idConcesion;
    }

    if (typeof normalizedQuery.idPeaje === 'number') {
      where.ID_PEAJE = normalizedQuery.idPeaje;
    }

    const hasFechaFiltro = Boolean(
      normalizedQuery.fechaInicio ||
      normalizedQuery.fechaFin ||
      normalizedQuery.mes !== undefined ||
      normalizedQuery.anio !== undefined ||
      normalizedQuery.rango,
    );
    if (!hasFechaFiltro) {
      // Por defecto limitamos a últimos 90 días para evitar respuestas muy grandes
      const ultimos90 = resolveRango('ultimos90d');
      if (ultimos90) {
        where.FECHA_FACTURA = ultimos90;
      }
    }

    const { current: rangoActual, previous: rangoAnterior, compare: compareMode } = buildRanges(normalizedQuery.rango);

    if (rangoActual) {
      where.FECHA_FACTURA = rangoActual;
    }

    if (normalizedQuery.fechaInicio || normalizedQuery.fechaFin) {
      const fechaFilter: Prisma.DateTimeFilter = {};
      if (normalizedQuery.fechaInicio) {
        fechaFilter.gte = new Date(normalizedQuery.fechaInicio);
      }
      if (normalizedQuery.fechaFin) {
        fechaFilter.lte = new Date(normalizedQuery.fechaFin);
      }
      where.FECHA_FACTURA = fechaFilter;
    }

    if (typeof normalizedQuery.mes === 'number') {
      const year = typeof normalizedQuery.anio === 'number' ? normalizedQuery.anio : new Date().getUTCFullYear();
      const start = new Date(Date.UTC(year, normalizedQuery.mes - 1, 1));
      const end = new Date(Date.UTC(year, normalizedQuery.mes, 0, 23, 59, 59, 999));
      where.FECHA_FACTURA = { gte: start, lte: end };
    } else if (typeof normalizedQuery.anio === 'number') {
      const start = new Date(Date.UTC(normalizedQuery.anio, 0, 1));
      const end = new Date(Date.UTC(normalizedQuery.anio, 11, 31, 23, 59, 59, 999));
      where.FECHA_FACTURA = { gte: start, lte: end };
    }

    if (normalizedQuery.cliente) {
      where.CLIENTE = { contains: normalizedQuery.cliente };
    }

    if (normalizedQuery.numeroDocumentoCliente) {
      where.NUM_DOCUMENTO_CLIENTE = { contains: normalizedQuery.numeroDocumentoCliente };
    }

    if (normalizedQuery.numeroFactura) {
      where.NUMERO_FACTURA = { contains: normalizedQuery.numeroFactura };
    }

    if (normalizedQuery.notaCredito) {
      where.NOTA_CREDITO = { contains: normalizedQuery.notaCredito };
    }

    if (normalizedQuery.formaPago) {
      where.FORMA_PAGO = { contains: normalizedQuery.formaPago };
    }

    const take = Math.min(normalizedQuery.take ?? 200, 10000);
    const skip = normalizedQuery.skip ?? 0;

    if (!compareMode && !includeData) {
      const aggregates = await this.buildVentasTagAggregatesFromDb(normalizedQuery);
      return { data: [], aggregates };
    }

    if (!compareMode) {
      return this.prisma.vW_VENTAS_TAG.findMany({
        where,
        orderBy: { FECHA_FACTURA: 'desc' },
        skip,
        take,
      });
    }

    if (compareMode && !includeData) {
      const aggregates = await this.buildVentasTagAggregatesFromDb(normalizedQuery);
      return { data: [], aggregates };
    }

    const whereAnterior: Prisma.VW_VENTAS_TAGWhereInput = { ...where };
    if (rangoAnterior) {
      whereAnterior.FECHA_FACTURA = rangoAnterior;
    }

    const [actualData, anteriorData] = await Promise.all([
      this.prisma.vW_VENTAS_TAG.findMany({ where, orderBy: { FECHA_FACTURA: 'desc' }, skip, take }),
      this.prisma.vW_VENTAS_TAG.findMany({ where: whereAnterior, orderBy: { FECHA_FACTURA: 'desc' }, skip, take }),
    ]);

    const sumValor = (rows: any[]) => rows.reduce((acc, r) => acc + Number(r.VALOR ?? 0), 0);
    const totalActual = sumValor(actualData);
    const totalAnterior = sumValor(anteriorData);
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

  private normalizeQuery(query: VentasTagQueryDto): VentasTagQueryDto {
    const normalized: VentasTagQueryDto = { ...query };

    if (!normalized.fechaInicio && normalized.desde) {
      normalized.fechaInicio = normalized.desde;
    }
    if (!normalized.fechaFin && normalized.hasta) {
      normalized.fechaFin = normalized.hasta;
    }

    if (normalized.nombrePeaje && typeof normalized.idPeaje !== 'number') {
      const nombre = normalized.nombrePeaje.trim().toUpperCase();
      const map: Record<string, number> = {
        CONGOMA: 1,
        'LOS ANGELES': 2,
      };
      const id = map[nombre];
      if (!id) {
        throw new BadRequestException('nombrePeaje no tiene id configurado.');
      }
      normalized.idPeaje = id;
    }

    return normalized;
  }

  private buildVentasTagDateFilter(
    query: VentasTagQueryDto,
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

    if (typeof query.mes === 'number') {
      const year = typeof query.anio === 'number' ? query.anio : new Date().getUTCFullYear();
      const start = new Date(Date.UTC(year, query.mes - 1, 1));
      const end = new Date(Date.UTC(year, query.mes, 0, 23, 59, 59, 999));
      return { gte: start, lte: end };
    }

    if (typeof query.anio === 'number') {
      const start = new Date(Date.UTC(query.anio, 0, 1));
      const end = new Date(Date.UTC(query.anio, 11, 31, 23, 59, 59, 999));
      return { gte: start, lte: end };
    }

    if (query.fechaInicio || query.fechaFin) {
      const fechaFilter: Prisma.DateTimeFilter = {};
      if (query.fechaInicio) fechaFilter.gte = new Date(query.fechaInicio);
      if (query.fechaFin) fechaFilter.lte = new Date(query.fechaFin);
      return fechaFilter;
    }

    if (query.rango) {
      return resolveRango(query.rango.replace('Anterior', ''));
    }

    const defaultRange = resolveRango('ultimos90d');
    return defaultRange;
  }

  private buildVentasTagSqlParts(
    query: VentasTagQueryDto,
    overrideRange?: Prisma.DateTimeFilter,
  ) {
    const conditions: Prisma.Sql[] = [];
    const fechaFilter = this.buildVentasTagDateFilter(query, overrideRange);
    if (fechaFilter?.gte) {
      conditions.push(Prisma.sql`vt.FECHA_FACTURA >= ${fechaFilter.gte}`);
    }
    if (fechaFilter?.lte) {
      conditions.push(Prisma.sql`vt.FECHA_FACTURA <= ${fechaFilter.lte}`);
    }

    if (typeof query.idConcesion === 'number') {
      conditions.push(Prisma.sql`vt.ID_CONCESION = ${query.idConcesion}`);
    }
    if (typeof query.idPeaje === 'number') {
      conditions.push(Prisma.sql`vt.ID_PEAJE = ${query.idPeaje}`);
    }
    if (query.cliente) {
      conditions.push(Prisma.sql`vt.CLIENTE LIKE ${'%' + query.cliente + '%'}`);
    }
    if (query.numeroDocumentoCliente) {
      conditions.push(Prisma.sql`vt.NUM_DOCUMENTO_CLIENTE LIKE ${'%' + query.numeroDocumentoCliente + '%'}`);
    }
    if (query.numeroFactura) {
      conditions.push(Prisma.sql`vt.NUMERO_FACTURA LIKE ${'%' + query.numeroFactura + '%'}`);
    }
    if (query.notaCredito) {
      conditions.push(Prisma.sql`vt.NOTA_CREDITO LIKE ${'%' + query.notaCredito + '%'}`);
    }
    if (query.formaPago) {
      conditions.push(Prisma.sql`vt.FORMA_PAGO LIKE ${'%' + query.formaPago + '%'}`);
    }

    return {
      fromSql: Prisma.sql`FROM VW_VENTAS_TAG vt`,
      whereSql: conditions.length
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql``,
    };
  }

  private async buildVentasTagAggregatesFromDb(query: VentasTagQueryDto) {
    const baseWhere = this.buildVentasTagSqlParts(query);
    const totalRows = await this.prisma.$queryRaw<
      Array<{ id_peaje: number; total: unknown; cantidad: unknown }>
    >(Prisma.sql`
      SELECT
        vt.ID_PEAJE as id_peaje,
        SUM(COALESCE(vt.VALOR,0)) as total,
        COUNT(*) as cantidad
      ${baseWhere.fromSql}
      ${baseWhere.whereSql}
      GROUP BY vt.ID_PEAJE
    `);

    const totalsMap = new Map<number, { total: number; cantidad: number }>();
    totalRows.forEach(row => {
      totalsMap.set(row.id_peaje, {
        total: this.toNumber(row.total),
        cantidad: this.toNumber(row.cantidad),
      });
    });

    const totalPorPeaje = {
      congoma: totalsMap.get(1)?.total ?? 0,
      losAngeles: totalsMap.get(2)?.total ?? 0,
    };
    const cantidadTags = totalRows.reduce((sum, row) => sum + this.toNumber(row.cantidad), 0);
    const totalGeneral = totalPorPeaje.congoma + totalPorPeaje.losAngeles;

    let changePercent: number | null = null;
    let arrow: 'up' | 'down' | 'flat' = 'flat';
    let footer = 'Sin datos suficientes para comparar';

    if (query.rango?.endsWith('Anterior')) {
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

      const base = query.rango.replace('Anterior', '');
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
        const prevWhere = this.buildVentasTagSqlParts(query, previous);
        const prevTotalRows = await this.prisma.$queryRaw<
          Array<{ total: unknown }>
        >(Prisma.sql`
          SELECT SUM(COALESCE(vt.VALOR,0)) as total
          ${prevWhere.fromSql}
          ${prevWhere.whereSql}
        `);
        const totalAnterior = this.toNumber(prevTotalRows[0]?.total);
        if (totalAnterior !== 0) {
          changePercent = ((totalGeneral - totalAnterior) / totalAnterior) * 100;
          arrow = changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';
          footer = `${arrow === 'up' ? '↗' : arrow === 'down' ? '↘' : '↔'} ${Math.abs(changePercent).toFixed(1)}% ${arrow === 'up' ? 'más' : arrow === 'down' ? 'menos' : 'igual'} que el periodo anterior`;
        }
      }
    }

    return {
      totalPorPeaje,
      totalGeneral,
      cantidadTags,
      changePercent,
      arrow,
      footer,
    };
  }
}
