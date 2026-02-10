import { Test, TestingModule } from '@nestjs/testing';
import { RecaudacionController } from './recaudacion.controller';
import { RecaudacionService } from './recaudacion.service';

describe('RecaudacionController', () => {
  let controller: RecaudacionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecaudacionController],
      providers: [RecaudacionService],
    }).compile();

    controller = module.get<RecaudacionController>(RecaudacionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
