import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma-service/prisma-service.service';
import { FacturacionQueryDto } from './dto/facturacion-query.dto';

@Injectable()
export class FacturacionService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FacturacionQueryDto) {
    const normalizedQuery = this.normalizeQuery(query);
    const where: Prisma.FACTURACION_COSADWhereInput = {};

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

    const hasFechaFiltro = Boolean(
      normalizedQuery.fechaInicio ||
      normalizedQuery.fechaFin ||
      normalizedQuery.mes !== undefined ||
      normalizedQuery.anio !== undefined ||
      normalizedQuery.rango,
    );
    if (!hasFechaFiltro) {
      const ultimoMes = resolveRango('ultimoMes');
      if (ultimoMes) {
        where.FECHA_FACTURA = ultimoMes;
      }
    }

    if (normalizedQuery.rango) {
      const rangoFilter = resolveRango(normalizedQuery.rango);
      if (rangoFilter) {
        where.FECHA_FACTURA = rangoFilter;
      }
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

    if (normalizedQuery.numeroDocumento) {
      where.NUMERO_DOCUMENTO = {
        contains: normalizedQuery.numeroDocumento,
      };
    }

    if (normalizedQuery.numeroFactura) {
      where.NUM_FACTURA = {
        contains: normalizedQuery.numeroFactura,
      };
    }

    if (normalizedQuery.razonSocial) {
      where.RAZON_SOCIAL = {
        contains: normalizedQuery.razonSocial,
      };
    }

    if (normalizedQuery.nombrePeaje) {
      where.NOMBRE_PEAJE = { contains: normalizedQuery.nombrePeaje };
    }

    if (normalizedQuery.placa) {
      where.PLACA = {
        contains: normalizedQuery.placa,
      };
    }

    if (normalizedQuery.tipo) {
      where.TIPO = {
        equals: normalizedQuery.tipo,
      };
    }

    if (typeof normalizedQuery.mes === 'number') {
      where.mes = { equals: normalizedQuery.mes } as any;
    }

    if (typeof normalizedQuery.anio === 'number') {
      where.YEAR = { equals: normalizedQuery.anio } as any;
    } else {
      // Limitar resultados a datos desde 2025 en adelante para evitar respuestas gigantes
      where.YEAR = { gte: 2025 } as any;
    }

    const take = Math.min(normalizedQuery.take ?? 200, 10000); // default 200, hard cap 10000
    const skip = normalizedQuery.skip ?? 0;

    return this.prisma.fACTURACION_COSAD.findMany({
      where,
      orderBy: { FECHA_FACTURA: 'desc' },
      skip,
      take,
    });
  }

  private normalizeQuery(query: FacturacionQueryDto): FacturacionQueryDto {
    const normalized: FacturacionQueryDto = { ...query };
    if (!normalized.fechaInicio && normalized.desde) {
      normalized.fechaInicio = normalized.desde;
    }
    if (!normalized.fechaFin && normalized.hasta) {
      normalized.fechaFin = normalized.hasta;
    }
    return normalized;
  }
}
