import { Test, TestingModule } from '@nestjs/testing';
import { CittService } from './citt.service';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { UserSettingsService } from '../users/user-settings.service';
import { JobsService } from '../jobs/jobs.service';
import { OrsService } from '../../common/services/ors.service';

describe('CittService', () => {
  let service: CittService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CittService,
        { provide: PrismaService, useValue: {} },
        { provide: RedisService, useValue: {} },
        { provide: GeocodingService, useValue: { geocode: jest.fn() } },
        { provide: UserSettingsService, useValue: { get: jest.fn() } },
        { provide: JobsService, useValue: {} },
        {
          provide: OrsService,
          useValue: {
            getRoute: jest
              .fn()
              .mockResolvedValue({ distanceMiles: 5, driveTimeMins: 12 }),
          },
        },
      ],
    }).compile();

    service = module.get<CittService>(CittService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
