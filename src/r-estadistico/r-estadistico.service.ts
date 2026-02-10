import { BadRequestException, Injectable } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma-service/prisma-service.service';
import { REstadisticoQueryDto } from './dto/r-estadistico-query.dto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { REstadisticoPdfDto } from './dto/r-estadistico-pdf.dto';

@Injectable()
export class REstadisticoService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: REstadisticoQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const includeData = normalizedQuery.includeData === true;
    const aggregatesPromise = this.buildAggregatesFromDb(normalizedQuery);
    if (!includeData) {
      return { data: [], aggregates: await aggregatesPromise };
    }

    const [data, aggregates] = await Promise.all([
      this.fetchData(normalizedQuery),
      aggregatesPromise,
    ]);
    return { data, aggregates };
  }

  async getTemporalAnalysis(query: REstadisticoQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const aggregates = await this.buildTemporalAggregatesFromDb(normalizedQuery);
    return { aggregates };
  }

  async getCabinasAnalysis(query: REstadisticoQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const aggregates = await this.buildCabinasAggregatesFromDb(normalizedQuery);
    return { aggregates };
  }

  private normalizeQuery(query: REstadisticoQueryDto): REstadisticoQueryDto {
    const normalized: REstadisticoQueryDto = { ...query };

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

  private async fetchData(query: REstadisticoQueryDto) {
    const where = this.buildWhereInput(query);

    const take = Math.min(query.take ?? 200, 30000);
    const skip = query.skip ?? 0;

    const orderBy: Prisma.VW_REPORTE_ESTADISTICO_CATVALOROrderByWithRelationInput[] = [
      { FECHA: 'desc' },
    ];

    const data = await this.prisma.vW_REPORTE_ESTADISTICO_CATVALOR.findMany({
      where,
      orderBy,
      skip,
      take,
    });

    return data;
  }


  private resolveRango(rango: string): Prisma.DateTimeFilter | undefined {
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
        const endPrev = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
        return { gte: startPrev, lte: endPrev };
      }
      default:
        return undefined;
    }
  }

  private buildFechaFilter(query: REstadisticoQueryDto): Prisma.DateTimeFilter {
    const minDate = new Date(Date.UTC(2025, 0, 1));
    let fechaFilter: Prisma.DateTimeFilter | undefined;

    const hasFechaFiltro = Boolean(
      query.fechaInicio ||
      query.fechaFin ||
      query.mes !== undefined ||
      query.anio !== undefined ||
      query.rango,
    );
    if (!hasFechaFiltro) {
      fechaFilter = this.resolveRango('ultimos7d');
    }

    if (query.rango) {
      const rangoFilter = this.resolveRango(query.rango);
      if (rangoFilter) {
        fechaFilter = rangoFilter;
      }
    }

    if (query.fechaInicio || query.fechaFin) {
      const customFilter: Prisma.DateTimeFilter = {};
      if (query.fechaInicio) {
        customFilter.gte = new Date(query.fechaInicio);
      }
      if (query.fechaFin) {
        customFilter.lte = new Date(query.fechaFin);
      }

      if (customFilter.gte && customFilter.lte) {
        const gteDate = customFilter.gte instanceof Date ? customFilter.gte : new Date(customFilter.gte);
        const lteDate = customFilter.lte instanceof Date ? customFilter.lte : new Date(customFilter.lte);
        const diffMs = lteDate.getTime() - gteDate.getTime();
        const maxMs = 90 * 24 * 60 * 60 * 1000;
        if (diffMs > maxMs) {
          throw new BadRequestException('El rango personalizado no puede superar 90 dias.');
        }
      }

      fechaFilter = customFilter;
    }

    if (!fechaFilter) {
      fechaFilter = { gte: minDate };
    } else {
      const currentGte = fechaFilter.gte ? new Date(fechaFilter.gte) : undefined;
      fechaFilter.gte = currentGte && currentGte > minDate ? currentGte : minDate;
    }

    return fechaFilter;
  }

  private buildWhereInput(query: REstadisticoQueryDto) {
    const where: Prisma.VW_REPORTE_ESTADISTICO_CATVALORWhereInput = {
      FECHA: this.buildFechaFilter(query),
    };

    if (typeof query.idConcesion === 'number') {
      where.ID_CONCESION = { equals: query.idConcesion } as any;
    }

    if (typeof query.idPeaje === 'number') {
      where.ID_PEAJE = { equals: query.idPeaje } as any;
    }

    if (typeof query.cabina === 'number') {
      where.CABINA = { equals: query.cabina } as any;
    }

    if (query.formaDePago) {
      where.FORMA_DE_PAGO = { equals: query.formaDePago } as any;
    }

    if (typeof query.mes === 'number') {
      where.MES = { equals: query.mes } as any;
    }

    if (typeof query.anio === 'number') {
      where.AÑO = { equals: query.anio } as any;
    }

    return where;
  }

  private buildWhereSql(query: REstadisticoQueryDto, extras: Prisma.Sql[] = []) {
    const fechaFilter = this.buildFechaFilter(query);
    const conditions: Prisma.Sql[] = [];

    if (fechaFilter.gte) {
      conditions.push(Prisma.sql`FECHA >= ${fechaFilter.gte}`);
    }
    if (fechaFilter.lte) {
      conditions.push(Prisma.sql`FECHA <= ${fechaFilter.lte}`);
    }
    if (typeof query.idConcesion === 'number') {
      conditions.push(Prisma.sql`ID_CONCESION = ${query.idConcesion}`);
    }
    if (typeof query.idPeaje === 'number') {
      conditions.push(Prisma.sql`ID_PEAJE = ${query.idPeaje}`);
    }
    if (typeof query.cabina === 'number') {
      conditions.push(Prisma.sql`CABINA = ${query.cabina}`);
    }
    if (query.formaDePago) {
      conditions.push(Prisma.sql`FORMA_DE_PAGO = ${query.formaDePago}`);
    }
    if (typeof query.mes === 'number') {
      conditions.push(Prisma.sql`MES = ${query.mes}`);
    }
    if (typeof query.anio === 'number') {
      conditions.push(Prisma.sql`[AÑO] = ${query.anio}`);
    }

    const allConditions = [...conditions, ...extras];
    return allConditions.length
      ? Prisma.sql`WHERE ${Prisma.join(allConditions, ' AND ')}`
      : Prisma.sql``;
  }

  private toNumber(value: unknown) {
    if (value === null || value === undefined) return 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private formatIsoDate(value: unknown) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  private formatHourLabel(hour: number) {
    const hh = String(Math.max(0, Math.min(23, hour))).padStart(2, '0');
    return `${hh}:00`;
  }

  private getPeajeNameFromId(idPeaje: number) {
    const map: Record<number, string> = {
      1: 'CONGOMA',
      2: 'LOS ANGELES',
    };
    return map[idPeaje];
  }

  private buildTransitosSqlParts(query: REstadisticoQueryDto, extras: Prisma.Sql[] = []) {
    const conditions: Prisma.Sql[] = [];
    const fechaFilter = this.buildFechaFilter(query);

    if (fechaFilter.gte) {
      conditions.push(Prisma.sql`vt.FECHA >= ${fechaFilter.gte}`);
    }
    if (fechaFilter.lte) {
      conditions.push(Prisma.sql`vt.FECHA <= ${fechaFilter.lte}`);
    }

    if (typeof query.idPeaje === 'number') {
      const peajeName = this.getPeajeNameFromId(query.idPeaje);
      if (!peajeName) {
        throw new BadRequestException('idPeaje no tiene nombre configurado para analisis de cabinas.');
      }
      conditions.push(Prisma.sql`vt.PEAJE = ${peajeName}`);
    }

    if (typeof query.cabina === 'number') {
      conditions.push(Prisma.sql`vt.CABINA = ${query.cabina}`);
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

  private buildTemporalSqlParts(query: REstadisticoQueryDto, extras: Prisma.Sql[] = []) {
    const joins: Prisma.Sql[] = [];
    const conditions: Prisma.Sql[] = [];

    const fechaFilter = this.buildFechaFilter(query);
    if (fechaFilter.gte) {
      conditions.push(Prisma.sql`vt.FECHA >= ${fechaFilter.gte}`);
    }
    if (fechaFilter.lte) {
      conditions.push(Prisma.sql`vt.FECHA <= ${fechaFilter.lte}`);
    }

    if (typeof query.idPeaje === 'number') {
      const peajeNameMap: Record<number, string> = {
        1: 'CONGOMA',
        2: 'LOS ANGELES',
      };
      const peajeName = peajeNameMap[query.idPeaje];
      if (!peajeName) {
        throw new BadRequestException('idPeaje no tiene nombre configurado para analisis temporal.');
      }
      conditions.push(Prisma.sql`vt.PEAJE = ${peajeName}`);
    }

    if (typeof query.cabina === 'number') {
      conditions.push(Prisma.sql`vt.CABINA = ${query.cabina}`);
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

  private async buildTemporalAggregatesFromDb(query: REstadisticoQueryDto) {
    const horaExpr = Prisma.sql`CAST(LEFT(vt.HORA, 2) as int)`;
    const { fromSql, whereSql } = this.buildTemporalSqlParts(query);
    const { whereSql: whereHourSql } = this.buildTemporalSqlParts(query, [
      Prisma.sql`vt.HORA IS NOT NULL`,
      Prisma.sql`LEN(vt.HORA) >= 2`,
      Prisma.sql`ISNUMERIC(LEFT(vt.HORA, 2)) = 1`,
    ]);

    const [dailyRows, hourlyRows, heatmapRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ fecha: unknown; cantidad: unknown }>>(Prisma.sql`
        SELECT
          CAST(vt.FECHA as date) as fecha,
          COUNT(*) as cantidad
        ${fromSql}
        ${whereSql}
        GROUP BY CAST(vt.FECHA as date)
        ORDER BY CAST(vt.FECHA as date)
      `),
      this.prisma.$queryRaw<Array<{ hora: unknown; cantidad: unknown }>>(Prisma.sql`
        SELECT
          ${horaExpr} as hora,
          COUNT(*) as cantidad
        ${fromSql}
        ${whereHourSql}
        GROUP BY ${horaExpr}
        ORDER BY ${horaExpr}
      `),
      this.prisma.$queryRaw<Array<{ dia: unknown; hora: unknown; cantidad: unknown }>>(Prisma.sql`
        SELECT
          DATEPART(WEEKDAY, vt.FECHA) as dia,
          ${horaExpr} as hora,
          COUNT(*) as cantidad
        ${fromSql}
        ${whereHourSql}
        GROUP BY DATEPART(WEEKDAY, vt.FECHA), ${horaExpr}
        ORDER BY DATEPART(WEEKDAY, vt.FECHA), ${horaExpr}
      `),
    ]);

    const tendenciaDiaria = dailyRows.map(row => ({
      fecha: this.formatIsoDate(row.fecha),
      cantidad: this.toNumber(row.cantidad),
    })).filter(item => item.fecha);

    const totalTransito = tendenciaDiaria.reduce((sum, row) => sum + row.cantidad, 0);
    const diasConDatos = tendenciaDiaria.length;
    const promedioDiario = diasConDatos > 0 ? totalTransito / diasConDatos : 0;

    let diaPico = { fecha: '', cantidad: 0 };
    if (tendenciaDiaria.length) {
      diaPico = tendenciaDiaria.reduce((max, row) => (row.cantidad > max.cantidad ? row : max), diaPico);
    }

    const hourlyTotals = hourlyRows.map(row => ({
      hora: this.toNumber(row.hora),
      cantidad: this.toNumber(row.cantidad),
    }));
    let horaPico = { hora: '', cantidad: 0 };
    if (hourlyTotals.length) {
      const maxHour = hourlyTotals.reduce((max, row) => (row.cantidad > max.cantidad ? row : max), hourlyTotals[0]);
      horaPico = { hora: this.formatHourLabel(maxHour.hora), cantidad: maxHour.cantidad };
    }

    const dayLabels = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    const weekStats = new Map<number, { total: number; count: number }>();
    tendenciaDiaria.forEach(row => {
      const date = new Date(`${row.fecha}T00:00:00Z`);
      const dayIndex = date.getUTCDay();
      const current = weekStats.get(dayIndex) ?? { total: 0, count: 0 };
      current.total += row.cantidad;
      current.count += 1;
      weekStats.set(dayIndex, current);
    });

    const promedioPorDiaSemana = dayLabels.map((label, idx) => {
      const stats = weekStats.get(idx) ?? { total: 0, count: 0 };
      const cantidad = stats.count > 0 ? stats.total / stats.count : 0;
      return { dia: label, cantidad, total: stats.total };
    });

    const heatmapDiaHora = heatmapRows.map(row => {
      const dayIndex = Math.max(0, Math.min(6, this.toNumber(row.dia) - 1));
      const hour = this.toNumber(row.hora);
      return {
        dia: dayLabels[dayIndex],
        hora: this.formatHourLabel(hour),
        cantidad: this.toNumber(row.cantidad),
      };
    });

    const sortedByCount = [...tendenciaDiaria].sort((a, b) => b.cantidad - a.cantidad);
    const top5Dias = sortedByCount.slice(0, 5);
    const bottom5Dias = [...tendenciaDiaria].sort((a, b) => a.cantidad - b.cantidad).slice(0, 5);

    return {
      totalTransito,
      promedioDiario,
      diaPico,
      horaPico,
      tendenciaDiaria,
      promedioPorDiaSemana,
      heatmapDiaHora,
      top5Dias,
      bottom5Dias,
    };
  }

  private async buildCabinasAggregatesFromDb(query: REstadisticoQueryDto) {
    const baseWhereSql = this.buildWhereSql(query);
    const sumCatsSql = Prisma.sql`(COALESCE(CAT1,0)+COALESCE(CAT2,0)+COALESCE(CAT3,0)+COALESCE(CAT4,0)+COALESCE(CAT5,0)+COALESCE(CAT6,0))`;
    const sumValsSql = Prisma.sql`(COALESCE(VALOR_1,0)+COALESCE(VALOR_2,0)+COALESCE(VALOR_3,0)+COALESCE(VALOR_4,0)+COALESCE(VALOR_5,0)+COALESCE(VALOR_6,0))`;

    const [totalRows, dailyRows, cabinaRows, tendenciaRows, pagoRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: unknown }>>(Prisma.sql`
        SELECT SUM(${sumCatsSql}) as total
        FROM VW_REPORTE_ESTADISTICO_CATVALOR
        ${baseWhereSql}
      `),
      this.prisma.$queryRaw<Array<{ fecha: unknown; cantidad: unknown }>>(Prisma.sql`
        SELECT CAST(FECHA as date) as fecha, SUM(${sumCatsSql}) as cantidad
        FROM VW_REPORTE_ESTADISTICO_CATVALOR
        ${baseWhereSql}
        GROUP BY CAST(FECHA as date)
        ORDER BY CAST(FECHA as date)
      `),
      this.prisma.$queryRaw<Array<{ cabina: number; cantidad: unknown; ingreso: unknown }>>(Prisma.sql`
        SELECT CABINA as cabina, SUM(${sumCatsSql}) as cantidad, SUM(${sumValsSql}) as ingreso
        FROM VW_REPORTE_ESTADISTICO_CATVALOR
        ${baseWhereSql}
        GROUP BY CABINA
        ORDER BY SUM(${sumCatsSql}) DESC
      `),
      this.prisma.$queryRaw<Array<{ fecha: unknown; cabina: number; cantidad: unknown }>>(Prisma.sql`
        SELECT CAST(FECHA as date) as fecha, CABINA as cabina, SUM(${sumCatsSql}) as cantidad
        FROM VW_REPORTE_ESTADISTICO_CATVALOR
        ${baseWhereSql}
        GROUP BY CAST(FECHA as date), CABINA
        ORDER BY CAST(FECHA as date), CABINA
      `),
      this.prisma.$queryRaw<Array<{ cabina: number; forma: string; cantidad: unknown }>>(Prisma.sql`
        SELECT
          CABINA as cabina,
          FORMA_DE_PAGO as forma,
          SUM(${sumCatsSql}) as cantidad
        FROM VW_REPORTE_ESTADISTICO_CATVALOR
        ${baseWhereSql}
        GROUP BY CABINA, FORMA_DE_PAGO
      `),
    ]);

    const totalTransitos = this.toNumber(totalRows[0]?.total);
    const promedioDiario = dailyRows.length > 0
      ? totalTransitos / dailyRows.length
      : 0;

    const cabinaTopRow = cabinaRows[0];
    const cabinaBottomRow = cabinaRows[cabinaRows.length - 1];
    const cabinaTop = cabinaTopRow
      ? { cabina: cabinaTopRow.cabina, cantidad: this.toNumber(cabinaTopRow.cantidad) }
      : { cabina: 0, cantidad: 0 };
    const cabinaBottom = cabinaBottomRow
      ? { cabina: cabinaBottomRow.cabina, cantidad: this.toNumber(cabinaBottomRow.cantidad) }
      : { cabina: 0, cantidad: 0 };

    const transitosPorCabina = cabinaRows.map(row => {
      const cantidad = this.toNumber(row.cantidad);
      const porcentaje = totalTransitos > 0 ? (cantidad / totalTransitos) * 100 : 0;
      return {
        cabina: row.cabina,
        cantidad,
        porcentaje,
        ingreso: this.toNumber(row.ingreso),
      };
    });

    const tendenciaPorCabina = tendenciaRows.map(row => ({
      fecha: this.formatIsoDate(row.fecha),
      cabina: row.cabina,
      cantidad: this.toNumber(row.cantidad),
    })).filter(item => item.fecha);

    const pagoMap = new Map<string, number>();
    pagoRows.forEach(row => {
      const forma = String(row.forma ?? '');
      let metodo = 'EXENTO';
      if (forma === 'EFEC.') {
        metodo = 'EFEC';
      } else if (forma.startsWith('RFID')) {
        metodo = 'RFID';
      }
      const key = `${row.cabina}|${metodo}`;
      pagoMap.set(key, (pagoMap.get(key) ?? 0) + this.toNumber(row.cantidad));
    });
    const pagoPorCabina = Array.from(pagoMap.entries()).map(([key, cantidad]) => {
      const [cabinaStr, metodo] = key.split('|');
      return {
        cabina: Number(cabinaStr),
        metodo,
        cantidad,
      };
    });

    const top5Cabinas = cabinaRows.slice(0, 5).map(row => ({
      cabina: row.cabina,
      cantidad: this.toNumber(row.cantidad),
    }));
    const bottom5Cabinas = [...cabinaRows]
      .sort((a, b) => this.toNumber(a.cantidad) - this.toNumber(b.cantidad))
      .slice(0, 5)
      .map(row => ({
        cabina: row.cabina,
        cantidad: this.toNumber(row.cantidad),
      }));

    const { fromSql: transFromSql, whereSql: transWhereSql } = this.buildTransitosSqlParts(query);
    const { whereSql: transWhereHourSql } = this.buildTransitosSqlParts(query, [
      Prisma.sql`vt.HORA IS NOT NULL`,
      Prisma.sql`LEN(vt.HORA) >= 2`,
      Prisma.sql`ISNUMERIC(LEFT(vt.HORA, 2)) = 1`,
    ]);
    const horaExpr = Prisma.sql`CAST(LEFT(vt.HORA, 2) as int)`;

    const [hourRows, cabinaTurnoRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ hora: unknown; cantidad: unknown }>>(Prisma.sql`
        SELECT ${horaExpr} as hora, COUNT(*) as cantidad
        ${transFromSql}
        ${transWhereHourSql}
        GROUP BY ${horaExpr}
        ORDER BY ${horaExpr}
      `),
      this.prisma.$queryRaw<Array<{ cabina: number; turno: number; cantidad: unknown }>>(Prisma.sql`
        SELECT vt.CABINA as cabina, vt.TURNO as turno, COUNT(*) as cantidad
        ${transFromSql}
        ${transWhereSql}
        GROUP BY vt.CABINA, vt.TURNO
        ORDER BY vt.CABINA, vt.TURNO
      `),
    ]);

    let horaPico = { hora: '', cantidad: 0 };
    if (hourRows.length) {
      const maxHour = hourRows.reduce((max, row) =>
        this.toNumber(row.cantidad) > this.toNumber(max.cantidad) ? row : max,
      hourRows[0]);
      horaPico = {
        hora: this.formatHourLabel(this.toNumber(maxHour.hora)),
        cantidad: this.toNumber(maxHour.cantidad),
      };
    }

    const transitosPorCabinaTurno = cabinaTurnoRows.map(row => ({
      cabina: row.cabina,
      turno: row.turno,
      cantidad: this.toNumber(row.cantidad),
    }));

    return {
      totalTransitos,
      promedioDiario,
      cabinaTop,
      cabinaBottom,
      horaPico,
      transitosPorCabina,
      tendenciaPorCabina,
      transitosPorCabinaTurno,
      pagoPorCabina,
      top5Cabinas,
      bottom5Cabinas,
    };
  }

  private async buildAggregatesFromDb(query: REstadisticoQueryDto) {
    const baseWhereSql = this.buildWhereSql(query);

    const totalsByForma = await this.prisma.$queryRaw<
      Array<{ forma: string; cat_total: unknown; val_total: unknown }>
    >(Prisma.sql`
      SELECT
        FORMA_DE_PAGO as forma,
        SUM(COALESCE(CAT1,0)+COALESCE(CAT2,0)+COALESCE(CAT3,0)+COALESCE(CAT4,0)+COALESCE(CAT5,0)+COALESCE(CAT6,0)) as cat_total,
        SUM(COALESCE(VALOR_1,0)+COALESCE(VALOR_2,0)+COALESCE(VALOR_3,0)+COALESCE(VALOR_4,0)+COALESCE(VALOR_5,0)+COALESCE(VALOR_6,0)) as val_total
      FROM VW_REPORTE_ESTADISTICO_CATVALOR
      ${baseWhereSql}
      GROUP BY FORMA_DE_PAGO
    `);

    const ingresoPorCategoriaRow = await this.prisma.$queryRaw<
      Array<{ val1: unknown; val2: unknown; val3: unknown; val4: unknown; val5: unknown; val6: unknown }>
    >(Prisma.sql`
      SELECT
        SUM(COALESCE(VALOR_1,0)) as val1,
        SUM(COALESCE(VALOR_2,0)) as val2,
        SUM(COALESCE(VALOR_3,0)) as val3,
        SUM(COALESCE(VALOR_4,0)) as val4,
        SUM(COALESCE(VALOR_5,0)) as val5,
        SUM(COALESCE(VALOR_6,0)) as val6
      FROM VW_REPORTE_ESTADISTICO_CATVALOR
      ${this.buildWhereSql(query, [Prisma.sql`FORMA_DE_PAGO = ${'EFEC.'}`])}
    `);

    const efecVsExentosRow = await this.prisma.$queryRaw<
      Array<{
        efec_cat1: unknown; efec_cat2: unknown; efec_cat3: unknown; efec_cat4: unknown; efec_cat5: unknown; efec_cat6: unknown;
        ex_cat1: unknown; ex_cat2: unknown; ex_cat3: unknown; ex_cat4: unknown; ex_cat5: unknown; ex_cat6: unknown;
      }>
    >(Prisma.sql`
      SELECT
        SUM(CASE WHEN FORMA_DE_PAGO = ${'EFEC.'} THEN COALESCE(CAT1,0) ELSE 0 END) as efec_cat1,
        SUM(CASE WHEN FORMA_DE_PAGO = ${'EFEC.'} THEN COALESCE(CAT2,0) ELSE 0 END) as efec_cat2,
        SUM(CASE WHEN FORMA_DE_PAGO = ${'EFEC.'} THEN COALESCE(CAT3,0) ELSE 0 END) as efec_cat3,
        SUM(CASE WHEN FORMA_DE_PAGO = ${'EFEC.'} THEN COALESCE(CAT4,0) ELSE 0 END) as efec_cat4,
        SUM(CASE WHEN FORMA_DE_PAGO = ${'EFEC.'} THEN COALESCE(CAT5,0) ELSE 0 END) as efec_cat5,
        SUM(CASE WHEN FORMA_DE_PAGO = ${'EFEC.'} THEN COALESCE(CAT6,0) ELSE 0 END) as efec_cat6,
        SUM(CASE WHEN FORMA_DE_PAGO <> ${'EFEC.'} THEN COALESCE(CAT1,0) ELSE 0 END) as ex_cat1,
        SUM(CASE WHEN FORMA_DE_PAGO <> ${'EFEC.'} THEN COALESCE(CAT2,0) ELSE 0 END) as ex_cat2,
        SUM(CASE WHEN FORMA_DE_PAGO <> ${'EFEC.'} THEN COALESCE(CAT3,0) ELSE 0 END) as ex_cat3,
        SUM(CASE WHEN FORMA_DE_PAGO <> ${'EFEC.'} THEN COALESCE(CAT4,0) ELSE 0 END) as ex_cat4,
        SUM(CASE WHEN FORMA_DE_PAGO <> ${'EFEC.'} THEN COALESCE(CAT5,0) ELSE 0 END) as ex_cat5,
        SUM(CASE WHEN FORMA_DE_PAGO <> ${'EFEC.'} THEN COALESCE(CAT6,0) ELSE 0 END) as ex_cat6
      FROM VW_REPORTE_ESTADISTICO_CATVALOR
      ${baseWhereSql}
    `);

    const rfidPorTipoRows = await this.prisma.$queryRaw<
      Array<{ tipo: string; cantidad: unknown; valor: unknown }>
    >(Prisma.sql`
      SELECT
        FORMA_DE_PAGO as tipo,
        SUM(COALESCE(CAT1,0)+COALESCE(CAT2,0)+COALESCE(CAT3,0)+COALESCE(CAT4,0)+COALESCE(CAT5,0)+COALESCE(CAT6,0)) as cantidad,
        SUM(COALESCE(VALOR_1,0)+COALESCE(VALOR_2,0)+COALESCE(VALOR_3,0)+COALESCE(VALOR_4,0)+COALESCE(VALOR_5,0)+COALESCE(VALOR_6,0)) as valor
      FROM VW_REPORTE_ESTADISTICO_CATVALOR
      ${this.buildWhereSql(query, [Prisma.sql`FORMA_DE_PAGO IN (${Prisma.join(['RFID 0 %', 'RFID 50 %', 'RFID 100 %'])})`])}
      GROUP BY FORMA_DE_PAGO
    `);

    const tiposExentosRows = await this.prisma.$queryRaw<
      Array<{ tipo: string; cantidad: unknown }>
    >(Prisma.sql`
      SELECT
        FORMA_DE_PAGO as tipo,
        SUM(COALESCE(CAT1,0)+COALESCE(CAT2,0)+COALESCE(CAT3,0)+COALESCE(CAT4,0)+COALESCE(CAT5,0)+COALESCE(CAT6,0)) as cantidad
      FROM VW_REPORTE_ESTADISTICO_CATVALOR
      ${this.buildWhereSql(query, [
        Prisma.sql`FORMA_DE_PAGO <> ${'EFEC.'}`,
        Prisma.sql`FORMA_DE_PAGO NOT LIKE ${'RFID%'}`,
      ])}
      GROUP BY FORMA_DE_PAGO
      ORDER BY cantidad DESC
    `);

    const evolucionRows = await this.prisma.$queryRaw<
      Array<{ anio: number; mes: number; valor: unknown }>
    >(Prisma.sql`
      SELECT
        [AÑO] as anio,
        MES as mes,
        SUM(COALESCE(VALOR_1,0)+COALESCE(VALOR_2,0)+COALESCE(VALOR_3,0)+COALESCE(VALOR_4,0)+COALESCE(VALOR_5,0)+COALESCE(VALOR_6,0)) as valor
      FROM VW_REPORTE_ESTADISTICO_CATVALOR
      ${this.buildWhereSql(query, [Prisma.sql`FORMA_DE_PAGO = ${'EFEC.'}`])}
      GROUP BY [AÑO], MES
      ORDER BY [AÑO], MES
    `);

    const getByForma = (forma: string) => totalsByForma.find(row => row.forma === forma);
    const efecRow = getByForma('EFEC.');
    const rfid0Row = getByForma('RFID 0 %');
    const rfid50Row = getByForma('RFID 50 %');
    const rfid100Row = getByForma('RFID 100 %');

    const exentosVehiculos = totalsByForma
      .filter(row => row.forma !== 'EFEC.' && !row.forma.startsWith('RFID'))
      .reduce((sum, row) => sum + this.toNumber(row.cat_total), 0);

    const ingresoEfec = this.toNumber(efecRow?.val_total);
    const ingresoRfid0 = this.toNumber(rfid0Row?.val_total);
    const ingresoRfid50 = this.toNumber(rfid50Row?.val_total);
    const ingresoTotal = ingresoEfec + ingresoRfid0 + ingresoRfid50;

    const vehiculosEfec = this.toNumber(efecRow?.cat_total);
    const vehiculosRfid100 = this.toNumber(rfid100Row?.cat_total);
    const vehiculosExentos = exentosVehiculos;
    const totalVehiculos = vehiculosEfec + vehiculosExentos + vehiculosRfid100;
    const porcentajeExentos = totalVehiculos > 0 ? ((vehiculosExentos + vehiculosRfid100) / totalVehiculos) * 100 : 0;

    const ingresoPorCategoriaRaw = ingresoPorCategoriaRow[0] ?? {
      val1: 0,
      val2: 0,
      val3: 0,
      val4: 0,
      val5: 0,
      val6: 0,
    };
    const ingresoPorCategoria = [
      { categoria: 'CAT 1', valor: this.toNumber(ingresoPorCategoriaRaw.val1) },
      { categoria: 'CAT 2', valor: this.toNumber(ingresoPorCategoriaRaw.val2) },
      { categoria: 'CAT 3', valor: this.toNumber(ingresoPorCategoriaRaw.val3) },
      { categoria: 'CAT 4', valor: this.toNumber(ingresoPorCategoriaRaw.val4) },
      { categoria: 'CAT 5', valor: this.toNumber(ingresoPorCategoriaRaw.val5) },
      { categoria: 'CAT 6', valor: this.toNumber(ingresoPorCategoriaRaw.val6) },
    ].filter(item => item.valor > 0);

    const efecVsExentosRaw = efecVsExentosRow[0] ?? {
      efec_cat1: 0,
      efec_cat2: 0,
      efec_cat3: 0,
      efec_cat4: 0,
      efec_cat5: 0,
      efec_cat6: 0,
      ex_cat1: 0,
      ex_cat2: 0,
      ex_cat3: 0,
      ex_cat4: 0,
      ex_cat5: 0,
      ex_cat6: 0,
    };
    const efecVsExentos = [
      { categoria: 'CAT 1', efec: this.toNumber(efecVsExentosRaw.efec_cat1), exentos: this.toNumber(efecVsExentosRaw.ex_cat1) },
      { categoria: 'CAT 2', efec: this.toNumber(efecVsExentosRaw.efec_cat2), exentos: this.toNumber(efecVsExentosRaw.ex_cat2) },
      { categoria: 'CAT 3', efec: this.toNumber(efecVsExentosRaw.efec_cat3), exentos: this.toNumber(efecVsExentosRaw.ex_cat3) },
      { categoria: 'CAT 4', efec: this.toNumber(efecVsExentosRaw.efec_cat4), exentos: this.toNumber(efecVsExentosRaw.ex_cat4) },
      { categoria: 'CAT 5', efec: this.toNumber(efecVsExentosRaw.efec_cat5), exentos: this.toNumber(efecVsExentosRaw.ex_cat5) },
      { categoria: 'CAT 6', efec: this.toNumber(efecVsExentosRaw.efec_cat6), exentos: this.toNumber(efecVsExentosRaw.ex_cat6) },
    ].filter(item => item.efec > 0 || item.exentos > 0);

    const rfidPorTipo = rfidPorTipoRows
      .map(row => ({
        tipo: row.tipo,
        cantidad: this.toNumber(row.cantidad),
        valor: this.toNumber(row.valor),
      }))
      .filter(item => item.cantidad > 0 || item.valor > 0);

    const tiposExentos = tiposExentosRows
      .map(row => ({
        tipo: row.tipo,
        cantidad: this.toNumber(row.cantidad),
      }))
      .filter(item => item.cantidad > 0);

    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const evolucionMensual = evolucionRows.map(row => {
      const label = `${meses[(row.mes ?? 1) - 1]} ${row.anio}`;
      return { mes: label, valor: this.toNumber(row.valor) };
    });

    return {
      ingresoTotal,
      vehiculosEfec,
      vehiculosExentos,
      vehiculosRfid100,
      porcentajeExentos,
      ingresoPorCategoria,
      efecVsExentos,
      rfidPorTipo,
      tiposExentos,
      evolucionMensual,
    };
  }

  private fmtCurrency(value: number) {
    return `$${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private describeRange(query: REstadisticoQueryDto) {
    if (query.rango) return query.rango;
    if (query.fechaInicio || query.fechaFin) return `Custom ${query.fechaInicio ?? ''} - ${query.fechaFin ?? ''}`.trim();
    return 'ultimos7d (por defecto)';
  }

  private buildAggregates(data: Array<Record<string, any>>) {
    const catKeys = ['CAT1', 'CAT2', 'CAT3', 'CAT4', 'CAT5', 'CAT6'] as const;
    const valKeys = ['VALOR_1', 'VALOR_2', 'VALOR_3', 'VALOR_4', 'VALOR_5', 'VALOR_6'] as const;

    const sumCats = (rows: Array<Record<string, any>>) =>
      catKeys.reduce((acc, key) => acc + rows.reduce((s, r) => s + (Number((r as any)[key]) || 0), 0), 0);

    const sumVals = (rows: Array<Record<string, any>>) =>
      valKeys.reduce((acc, key) => acc + rows.reduce((s, r) => s + (Number((r as any)[key]) || 0), 0), 0);

    const efec = data.filter(r => r.FORMA_DE_PAGO === 'EFEC.');
    const rfid0 = data.filter(r => r.FORMA_DE_PAGO === 'RFID 0 %');
    const rfid50 = data.filter(r => r.FORMA_DE_PAGO === 'RFID 50 %');
    const rfid100 = data.filter(r => r.FORMA_DE_PAGO === 'RFID 100 %');
    const exentos = data.filter(r => r.FORMA_DE_PAGO !== 'EFEC.' && !String(r.FORMA_DE_PAGO ?? '').startsWith('RFID'));

    const ingresoEfec = sumVals(efec);
    const ingresoRfid0 = sumVals(rfid0);
    const ingresoRfid50 = sumVals(rfid50);
    const ingresoTotal = ingresoEfec + ingresoRfid0 + ingresoRfid50;

    const vehiculosEfec = sumCats(efec);
    const vehiculosExentos = sumCats(exentos);
    const vehiculosRfid100 = sumCats(rfid100);
    const totalVehiculos = vehiculosEfec + vehiculosExentos + vehiculosRfid100;
    const porcentajeExentos = totalVehiculos > 0 ? ((vehiculosExentos + vehiculosRfid100) / totalVehiculos) * 100 : 0;

    const ingresoPorCategoria = valKeys.map((key, idx) => {
      const total = efec.reduce((s, r) => s + (Number((r as any)[key]) || 0), 0);
      return { categoria: `CAT ${idx + 1}`, valor: total };
    }).filter(item => item.valor > 0);

    const efecVsExentos = catKeys.map((key, idx) => {
      const efecVal = efec.reduce((s, r) => s + (Number((r as any)[key]) || 0), 0);
      const exVal = data.filter(r => r.FORMA_DE_PAGO !== 'EFEC.').reduce((s, r) => s + (Number((r as any)[key]) || 0), 0);
      return { categoria: `CAT ${idx + 1}`, efec: efecVal, exentos: exVal };
    }).filter(item => item.efec > 0 || item.exentos > 0);

    const rfidPorTipo = ['RFID 0 %', 'RFID 50 %', 'RFID 100 %'].map(tipo => {
      const rows = data.filter(r => r.FORMA_DE_PAGO === tipo);
      return {
        tipo,
        cantidad: sumCats(rows),
        valor: sumVals(rows),
      };
    }).filter(item => item.cantidad > 0 || item.valor > 0);

    const tiposExentosMap = new Map<string, number>();
    exentos.forEach(r => {
      const tipo = String(r.FORMA_DE_PAGO ?? 'DESCONOCIDO');
      const cantidad = catKeys.reduce((s, key) => s + (Number((r as any)[key]) || 0), 0);
      tiposExentosMap.set(tipo, (tiposExentosMap.get(tipo) || 0) + cantidad);
    });
    const tiposExentos = Array.from(tiposExentosMap.entries()).map(([tipo, cantidad]) => ({ tipo, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const evolMap = new Map<string, number>();
    efec.forEach(r => {
      const key = `${r.AÑO}-${String(r.MES).padStart(2, '0')}`;
      evolMap.set(key, (evolMap.get(key) || 0) + (valKeys.reduce((s, k) => s + (Number((r as any)[k]) || 0), 0)));
    });
    const evolucionMensual = Array.from(evolMap.entries()).map(([key, valor]) => {
      const [año, mes] = key.split('-');
      const label = `${meses[parseInt(mes, 10) - 1]} ${año}`;
      return { mes: label, valor };
    }).sort((a, b) => a.mes.localeCompare(b.mes));

    return {
      ingresoTotal,
      vehiculosEfec,
      vehiculosExentos,
      vehiculosRfid100,
      porcentajeExentos,
      ingresoPorCategoria,
      efecVsExentos,
      rfidPorTipo,
      tiposExentos,
      evolucionMensual,
    };
  }
}
