import { Module } from '@nestjs/common';
import { RecaudacionService } from './recaudacion.service';
import { RecaudacionController } from './recaudacion.controller';
import { PrismaService } from '../prisma-service/prisma-service.service';

@Module({
  controllers: [RecaudacionController],
  providers: [RecaudacionService, PrismaService],
})
export class RecaudacionModule {}
