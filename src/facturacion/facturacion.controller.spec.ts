import { Test, TestingModule } from '@nestjs/testing';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';
import { PrismaService } from '../prisma-service/prisma-service.service';

describe('FacturacionController', () => {
  let controller: FacturacionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FacturacionController],
      providers: [
        FacturacionService,
        {
          provide: PrismaService,
          useValue: {
            fACTURACION_COSAD: { findMany: jest.fn() },
          },
        },
      ],
    }).compile();

    controller = module.get<FacturacionController>(FacturacionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
