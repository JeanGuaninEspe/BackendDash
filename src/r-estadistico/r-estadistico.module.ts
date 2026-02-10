import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma-service/prisma-service.service';
import { REstadisticoService } from './r-estadistico.service';
import { REstadisticoController } from './r-estadistico.controller';

@Module({
  controllers: [REstadisticoController],
  providers: [REstadisticoService, PrismaService],
})
export class REstadisticoModule {}
