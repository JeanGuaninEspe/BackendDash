import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

class ChartImageDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  dataUrl!: string;

  @IsOptional()
  @IsString()
  section?: 'kpis' | 'full' | 'row' | 'half';
}

class KpisDto {
  @IsOptional()
  @IsNumber()
  ingresoTotal?: number;

  @IsOptional()
  @IsNumber()
  vehiculosEfec?: number;

  @IsOptional()
  @IsNumber()
  vehiculosExentos?: number;

  @IsOptional()
  @IsNumber()
  vehiculosRfid100?: number;

  @IsOptional()
  @IsNumber()
  porcentajeExentos?: number;
}

export class REstadisticoPdfDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChartImageDto)
  charts!: ChartImageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => KpisDto)
  kpis?: KpisDto;

  @IsOptional()
  @IsString()
  peaje?: string;

  @IsOptional()
  @IsString()
  timeRange?: string;
}
