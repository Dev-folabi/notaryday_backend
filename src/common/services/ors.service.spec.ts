import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrsService, OptimiseJob } from './ors.service';
import { RedisService } from '../../config/redis.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OrsService (optimise)', () => {
  let service: OrsService;

  const redisMock = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  };

  const configMock = {
    get: jest.fn((key: string) => {
      if (key === 'ors.apiKey') return 'test-key';
      if (key === 'ors.baseUrl') return 'https://api.example.org/v2';
      return undefined;
    }),
  };

  const job = (id: string, opts: Partial<OptimiseJob> = {}): OptimiseJob => ({
    id,
    lat: 33.74,
    lng: -84.39,
    appointmentTime: new Date('2026-08-05T13:00:00.000Z'),
    signingDurationMins: 60,
    scanbackDurationMins: 20,
    ...opts,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrsService,
        { provide: ConfigService, useValue: configMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    service = module.get<OrsService>(OrsService);

    mockedAxios.post.mockResolvedValue({
      data: {
        routes: [
          {
            steps: [
              { type: 'job', id: 1 },
              { type: 'job', id: 2 },
            ],
          },
        ],
      },
    });
  });

  it('sends signing + scanback time as the ORS service duration', async () => {
    await service.optimise(33.7, -84.4, [job('a'), job('b')]);

    const body = mockedAxios.post.mock.calls[0][1] as {
      jobs: { service: number }[];
    };
    // (60 + 20) minutes in seconds
    expect(body.jobs[0].service).toBe(80 * 60);
  });

  it('anchors jobs with time windows around their appointment', async () => {
    await service.optimise(33.7, -84.4, [
      job('a', { appointmentTime: new Date('2026-08-05T13:00:00.000Z') }),
      job('b', { appointmentTime: new Date('2026-08-05T15:00:00.000Z') }),
    ]);

    const body = mockedAxios.post.mock.calls[0][1] as {
      jobs: { time_windows?: [number, number][] }[];
    };
    const ts = new Date('2026-08-05T13:00:00.000Z').getTime() / 1000;
    expect(body.jobs[0].time_windows).toEqual([[ts - 600, ts + 600]]);
  });

  it('bounds the vehicle to the day window', async () => {
    await service.optimise(33.7, -84.4, [
      job('a', { appointmentTime: new Date('2026-08-05T09:00:00.000Z') }),
      job('b', { appointmentTime: new Date('2026-08-05T13:00:00.000Z') }),
    ]);

    const body = mockedAxios.post.mock.calls[0][1] as {
      vehicles: { time_window: [number, number] }[];
    };
    const start = new Date('2026-08-05T09:00:00.000Z').getTime() / 1000;
    const end = new Date('2026-08-05T13:00:00.000Z').getTime() / 1000;
    expect(body.vehicles[0].time_window).toEqual([
      start - 1800,
      end + 6 * 3600,
    ]);
  });

  it('omits the vehicle window when any job lacks an appointment time', async () => {
    await service.optimise(33.7, -84.4, [
      job('a', { appointmentTime: new Date('2026-08-05T09:00:00.000Z') }),
      job('b', { appointmentTime: undefined }),
    ]);

    const body = mockedAxios.post.mock.calls[0][1] as {
      vehicles: { time_window?: [number, number] }[];
    };
    expect(body.vehicles[0].time_window).toBeUndefined();
  });

  it('falls back to time order when ORS fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('API down'));

    const getRoute = jest
      .spyOn(
        service as unknown as { getRoute: () => Promise<null> },
        'getRoute',
      )
      .mockResolvedValue(null);

    const legs = await service.optimise(33.7, -84.4, [
      job('late', { appointmentTime: new Date('2026-08-05T13:00:00.000Z') }),
      job('early', { appointmentTime: new Date('2026-08-05T09:00:00.000Z') }),
    ]);

    expect(getRoute).toHaveBeenCalled();
    // time order: early first, late second
    expect(legs[0].jobId).toBe('early');
    expect(legs[1].jobId).toBe('late');
    expect(legs[0].sequence).toBe(1);
    expect(legs[1].sequence).toBe(2);
  });
});
