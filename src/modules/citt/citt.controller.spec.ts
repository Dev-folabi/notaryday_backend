import { Test, TestingModule } from '@nestjs/testing';
import { CittController } from './citt.controller';

describe('CittController', () => {
  let controller: CittController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CittController],
    }).compile();

    controller = module.get<CittController>(CittController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
