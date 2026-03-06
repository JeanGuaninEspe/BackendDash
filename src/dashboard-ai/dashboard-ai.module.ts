import { Module } from '@nestjs/common';
import { DashboardAiController } from './dashboard-ai.controller';
import { DashboardAiService } from './dashboard-ai.service';
import { PrismaService } from 'src/prisma-service/prisma-service.service';

@Module({
  controllers: [DashboardAiController],
  providers: [DashboardAiService, PrismaService],
})
export class DashboardAiModule {}
