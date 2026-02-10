import { Test, TestingModule } from '@nestjs/testing';
import { FacturacionService } from './facturacion.service';
import { PrismaService } from '../prisma-service/prisma-service.service';

describe('FacturacionService', () => {
  let service: FacturacionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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

    service = module.get<FacturacionService>(FacturacionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
