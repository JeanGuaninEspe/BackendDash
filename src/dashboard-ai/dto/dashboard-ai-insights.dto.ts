import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { DashboardAiChartResponse } from '../dashboard-ai.types';

class DashboardAiInsightRowDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @Type(() => Number)
  @IsNumber()
  value!: number;
}

class DashboardAiInsightSeriesDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  data!: number[];
}

class DashboardAiInsightChartDto {
  @IsString()
  @MinLength(1)
  type!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsArray()
  @IsString({ each: true })
  labels!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DashboardAiInsightSeriesDto)
  series!: DashboardAiInsightSeriesDto[];
}

export class DashboardAiInsightsDto {
  @IsString()
  @MinLength(4)
  @MaxLength(3000)
  prompt!: string;

  @IsObject()
  query!: DashboardAiChartResponse['query'];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DashboardAiInsightRowDto)
  rows!: DashboardAiInsightRowDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardAiInsightChartDto)
  chart?: DashboardAiInsightChartDto;
}
