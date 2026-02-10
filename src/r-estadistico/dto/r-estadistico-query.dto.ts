import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

export class REstadisticoQueryDto {
  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @IsIn(['ultimos7d', 'ultimos15d', 'ultimos90d', 'mesActual', 'ultimoMes'])
  rango?: 'ultimos7d' | 'ultimos15d' | 'ultimos90d' | 'mesActual' | 'ultimoMes';

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  idConcesion?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  idPeaje?: number;

  @IsOptional()
  @IsString()
  nombrePeaje?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  cabina?: number;

  @IsOptional()
  formaDePago?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  mes?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  anio?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50000)
  @Type(() => Number)
  take?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return Boolean(value);
  })
  includeData?: boolean;
}
