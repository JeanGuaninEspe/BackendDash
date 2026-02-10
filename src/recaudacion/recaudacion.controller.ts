import { Controller, Get, Query } from '@nestjs/common';
import { RecaudacionService } from './recaudacion.service';
import { RecaudacionQueryDto } from './dto/recaudacion-query.dto';

@Controller('recaudacion')
export class RecaudacionController {
  constructor(private readonly recaudacionService: RecaudacionService) {}

  @Get()
  findAll(@Query() query: RecaudacionQueryDto) {
    return this.recaudacionService.findAll(query);
  }
}
