import { Module } from '@nestjs/common';
import { TransitosService } from './transitos.service';
import { TransitosController } from './transitos.controller';
import { PrismaService } from '../prisma-service/prisma-service.service';

@Module({
  controllers: [TransitosController],
  providers: [TransitosService, PrismaService],
})
export class TransitosModule {}
