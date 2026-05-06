import { Test, TestingModule } from '@nestjs/testing';
import { CittService } from './citt.service';

describe('CittService', () => {
  let service: CittService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CittService],
    }).compile();

    service = module.get<CittService>(CittService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
