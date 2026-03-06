import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DASHBOARD_AI_CHART_TYPES } from '../dashboard-ai.types';
import type { DashboardAiChartType } from '../dashboard-ai.types';

export class DashboardAiQueryDto {
  @IsString()
  @MinLength(4)
  @MaxLength(3000)
  prompt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn(DASHBOARD_AI_CHART_TYPES)
  preferredChartType?: DashboardAiChartType;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInsights?: boolean;
}
