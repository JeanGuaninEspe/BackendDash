import { Module } from '@nestjs/common';
import { VentasTagController } from './ventas-tag.controller';
import { VentasTagService } from './ventas-tag.service';
import { PrismaService } from '../prisma-service/prisma-service.service';

@Module({
  controllers: [VentasTagController],
  providers: [VentasTagService, PrismaService],
})
export class VentasTagModule {}
