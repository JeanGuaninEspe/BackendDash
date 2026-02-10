import { Controller, Get, Query } from '@nestjs/common';
import { FacturacionService } from './facturacion.service';
import { FacturacionQueryDto } from './dto/facturacion-query.dto';

@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly facturacionService: FacturacionService) {}

  @Get()
  async findAll(@Query() query: FacturacionQueryDto) {
    return this.facturacionService.findAll(query);
  }
}
