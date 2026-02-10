import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma-service/prisma-service.service';
import { TransitosQueryDto } from './dto/transitos-query.dto';

@Injectable()
export class TransitosService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: TransitosQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const includeData = normalizedQuery.includeData === true;
    const where: Prisma.VISTA_TRANSITOSWhereInput = {};

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
        fechaFilter.gte = new Date(normalizedQuery.fechaInicio);
      }
      if (normalizedQuery.fechaFin) {
        fechaFilter.lte = new Date(normalizedQuery.fechaFin);
      }
      where.FECHA = fechaFilter;
    }

    if (normalizedQuery.peajeNombre) {
      where.PEAJE = { equals: normalizedQuery.peajeNombre };
    } else if (normalizedQuery.nombrePeaje) {
      where.PEAJE = { contains: normalizedQuery.nombrePeaje };
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
    }
    if (normalizedQuery.tipo1) {
      where.TIPO_1 = { contains: normalizedQuery.tipo1 };
    }
    if (normalizedQuery.tipo2) {
      where.TIPO_2 = { contains: normalizedQuery.tipo2 };
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

  private buildTemporalSqlParts(query: TransitosQueryDto, extras: Prisma.Sql[] = []) {
    const conditions: Prisma.Sql[] = [];

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
      query.fechaInicio ||
      query.fechaFin ||
      query.mes !== undefined ||
      query.anio !== undefined ||
      query.semana !== undefined ||
      query.rango,
    );
    if (!hasFechaFiltro) {
      const ultimoMes = resolveRango('ultimoMes');
      if (ultimoMes?.gte) {
        conditions.push(Prisma.sql`vt.FECHA >= ${ultimoMes.gte}`);
      }
      if (ultimoMes?.lte) {
        conditions.push(Prisma.sql`vt.FECHA <= ${ultimoMes.lte}`);
      }
    }

    const { current: rangoActual } = buildRanges(query.rango);
    if (rangoActual?.gte) {
      conditions.push(Prisma.sql`vt.FECHA >= ${rangoActual.gte}`);
    }
    if (rangoActual?.lte) {
      conditions.push(Prisma.sql`vt.FECHA <= ${rangoActual.lte}`);
    }

    if (query.fechaInicio || query.fechaFin) {
      if (query.fechaInicio) {
        conditions.push(Prisma.sql`vt.FECHA >= ${new Date(query.fechaInicio)}`);
      }
      if (query.fechaFin) {
        conditions.push(Prisma.sql`vt.FECHA <= ${new Date(query.fechaFin)}`);
      }
    }

    if (query.peajeNombre) {
      conditions.push(Prisma.sql`vt.PEAJE = ${query.peajeNombre}`);
    } else if (query.nombrePeaje) {
      conditions.push(Prisma.sql`vt.PEAJE LIKE ${'%' + query.nombrePeaje + '%'}`);
    } else if (query.peaje) {
      conditions.push(Prisma.sql`vt.PEAJE LIKE ${'%' + query.peaje + '%'}`);
    }

    if (query.cabina) {
      const cabNum = Number(query.cabina);
      if (!Number.isNaN(cabNum)) {
        conditions.push(Prisma.sql`vt.CABINA = ${cabNum}`);
      }
    }
    if (query.turno) {
      const turnoNum = Number(query.turno);
      if (!Number.isNaN(turnoNum)) {
        conditions.push(Prisma.sql`vt.TURNO = ${turnoNum}`);
      }
    }
    if (query.noFactura) {
      conditions.push(Prisma.sql`vt.No_FACTURA LIKE ${'%' + query.noFactura + '%'}`);
    }
    if (query.numeroParte) {
      conditions.push(Prisma.sql`vt.NUMERO_PARTE LIKE ${'%' + query.numeroParte + '%'}`);
    }
    if (query.nombreCajero) {
      conditions.push(Prisma.sql`vt.NOMBRE_CAJERO LIKE ${'%' + query.nombreCajero + '%'}`);
    }
    if (query.placa) {
      conditions.push(Prisma.sql`vt.PLACA LIKE ${'%' + query.placa + '%'}`);
    }
    if (query.categoria) {
      conditions.push(Prisma.sql`vt.CATEGORIA LIKE ${'%' + query.categoria + '%'}`);
    }
    if (query.tipo1) {
      conditions.push(Prisma.sql`vt.TIPO_1 LIKE ${'%' + query.tipo1 + '%'}`);
    }
    if (query.tipo2) {
      conditions.push(Prisma.sql`vt.TIPO_2 LIKE ${'%' + query.tipo2 + '%'}`);
    }
    if (typeof query.semana === 'number') {
      conditions.push(Prisma.sql`vt.SEMANA = ${query.semana}`);
    }
    if (typeof query.mes === 'number') {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const mesValue = monthNames[query.mes - 1];
      if (mesValue) {
        conditions.push(Prisma.sql`vt.MES = ${mesValue}`);
      }
    }
    if (typeof query.anio === 'number') {
      conditions.push(Prisma.sql`vt.ANIO = ${query.anio}`);
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
