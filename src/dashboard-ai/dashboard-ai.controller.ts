import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardAiInsightsDto } from './dto/dashboard-ai-insights.dto';
import { DashboardAiQueryDto } from './dto/dashboard-ai-query.dto';
import { DashboardAiService } from './dashboard-ai.service';

@Controller('dashboard-ai')
@UseGuards(JwtAuthGuard)
export class DashboardAiController {
  constructor(private readonly dashboardAiService: DashboardAiService) {}

  @Post('query')
  query(@Body() dto: DashboardAiQueryDto) {
    return this.dashboardAiService.query(dto);
  }

  @Post('insights')
  insights(@Body() dto: DashboardAiInsightsDto) {
    return this.dashboardAiService.insights(dto);
  }
}
