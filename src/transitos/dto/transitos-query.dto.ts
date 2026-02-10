import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class TransitosQueryDto {
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
  @IsString()
  peaje?: string;

  @IsOptional()
  @IsIn(['CONGOMA', 'LOS ANGELES'])
  peajeNombre?: string;

  @IsOptional()
  @IsString()
  nombrePeaje?: string;

  @IsOptional()
  @IsString()
  cabina?: string;

  @IsOptional()
  @IsString()
  turno?: string;

  @IsOptional()
  @IsString()
  noFactura?: string;

  @IsOptional()
  @IsString()
  numeroParte?: string;

  @IsOptional()
  @IsString()
  nombreCajero?: string;

  @IsOptional()
  @IsString()
  placa?: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsString()
  tipo1?: string;

  @IsOptional()
  @IsString()
  tipo2?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(53)
  semana?: number;

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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
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
