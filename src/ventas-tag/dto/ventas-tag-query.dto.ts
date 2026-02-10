import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class VentasTagQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  idConcesion?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  idPeaje?: number;

  @IsOptional()
  @IsString()
  nombrePeaje?: string;

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
  @IsIn([
    'ultimos7d',
    'ultimos15d',
    'ultimos90d',
    'mesActual',
    'ultimoMes',
    'ultimos7dAnterior',
    'ultimos15dAnterior',
    'ultimos90dAnterior',
    'ultimoMesAnterior',
  ])
  rango?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(3000)
  anio?: number;

  @IsOptional()
  @IsString()
  cliente?: string;

  @IsOptional()
  @IsString()
  numeroDocumentoCliente?: string;

  @IsOptional()
  @IsString()
  numeroFactura?: string;

  @IsOptional()
  @IsString()
  notaCredito?: string;

  @IsOptional()
  @IsString()
  formaPago?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return Boolean(value);
  })
  includeData?: boolean;
}
