import { PartialType } from '@nestjs/mapped-types';
import { CreateREstadisticoDto } from './create-r-estadistico.dto';

export class UpdateREstadisticoDto extends PartialType(CreateREstadisticoDto) {}
