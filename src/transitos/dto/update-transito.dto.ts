import { PartialType } from '@nestjs/mapped-types';
import { CreateTransitoDto } from './create-transito.dto';

export class UpdateTransitoDto extends PartialType(CreateTransitoDto) {}
