import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { REstadisticoService } from './r-estadistico.service';
import { REstadisticoQueryDto } from './dto/r-estadistico-query.dto';
import { REstadisticoPdfDto } from './dto/r-estadistico-pdf.dto';

@Controller('r-estadistico')
export class REstadisticoController {
  constructor(private readonly rEstadisticoService: REstadisticoService) {}

  @Get()
  findAll(@Query() query: REstadisticoQueryDto) {
    return this.rEstadisticoService.findAll(query);
  }

  @Get('analisis-temporal')
  temporalAnalysis(@Query() query: REstadisticoQueryDto) {
    return this.rEstadisticoService.getTemporalAnalysis(query);
  }

  @Get('analisis-cabinas')
  cabinasAnalysis(@Query() query: REstadisticoQueryDto) {
    return this.rEstadisticoService.getCabinasAnalysis(query);
  }

  @Get('transitos-diarios')
  transitosDiarios(@Query() query: REstadisticoQueryDto) {
    return this.rEstadisticoService.getTransitosDailySummary(query);
  }

  @Get('anual')
  findAnnualByMonth(@Query() query: REstadisticoQueryDto) {
    return this.rEstadisticoService.findAnnualByMonth(query);
  }

  @Get('reporte-mensual-semanal')
  monthlyWeeklyReport(@Query() query: REstadisticoQueryDto) {
    return this.rEstadisticoService.getMonthlyWeeklyReport(query);
  }

}
