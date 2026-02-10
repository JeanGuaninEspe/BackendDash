import { Test, TestingModule } from '@nestjs/testing';
import { REstadisticoService } from './r-estadistico.service';

describe('REstadisticoService', () => {
  let service: REstadisticoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [REstadisticoService],
    }).compile();

    service = module.get<REstadisticoService>(REstadisticoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
