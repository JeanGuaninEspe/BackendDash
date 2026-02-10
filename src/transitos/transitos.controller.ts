import { Controller, Get, Query } from '@nestjs/common';
import { TransitosService } from './transitos.service';
import { TransitosQueryDto } from './dto/transitos-query.dto';

@Controller('transitos')
export class TransitosController {
  constructor(private readonly transitosService: TransitosService) {}

  @Get()
  async findAll(@Query() query: TransitosQueryDto) {
    return this.transitosService.findAll(query);
  }
}
