import { Test, TestingModule } from '@nestjs/testing';
import { TransitosController } from './transitos.controller';
import { TransitosService } from './transitos.service';
import { PrismaService } from '../prisma-service/prisma-service.service';

describe('TransitosController', () => {
  let controller: TransitosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransitosController],
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

    controller = module.get<TransitosController>(TransitosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
