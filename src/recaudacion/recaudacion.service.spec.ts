import { Test, TestingModule } from '@nestjs/testing';
import { RecaudacionService } from './recaudacion.service';

describe('RecaudacionService', () => {
  let service: RecaudacionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RecaudacionService],
    }).compile();

    service = module.get<RecaudacionService>(RecaudacionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
