import { Test, TestingModule } from '@nestjs/testing';
import { CittController } from './citt.controller';
import { CittService } from './citt.service';
import { AuthGuard } from '../../common/guards/auth.guard';

describe('CittController', () => {
  let controller: CittController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CittController],
      providers: [{ provide: CittService, useValue: {} }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<CittController>(CittController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
