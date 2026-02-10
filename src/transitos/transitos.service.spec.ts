import { Test, TestingModule } from '@nestjs/testing';
import { TransitosService } from './transitos.service';
import { PrismaService } from '../prisma-service/prisma-service.service';

describe('TransitosService', () => {
  let service: TransitosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransitosService,
        {
          provide: PrismaService,
          useValue: {
            vISTA_TRANSITOS: { findMany: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<TransitosService>(TransitosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
