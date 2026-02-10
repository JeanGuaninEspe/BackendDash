import { Test, TestingModule } from '@nestjs/testing';
import { REstadisticoController } from './r-estadistico.controller';
import { REstadisticoService } from './r-estadistico.service';

describe('REstadisticoController', () => {
  let controller: REstadisticoController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [REstadisticoController],
      providers: [REstadisticoService],
    }).compile();

    controller = module.get<REstadisticoController>(REstadisticoController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
