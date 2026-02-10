import { Controller, Get, Query } from '@nestjs/common';
import { VentasTagService } from './ventas-tag.service';
import { VentasTagQueryDto } from './dto/ventas-tag-query.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

@Controller('ventas-tag')
export class VentasTagController {
  constructor(private readonly ventasTagService: VentasTagService) {}

  @Get()
  async findAll(@Query() query: VentasTagQueryDto) {
    return this.ventasTagService.findAll(query);
  }
}
