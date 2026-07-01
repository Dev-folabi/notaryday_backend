import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RedisService } from '../../config/redis.service';

const ORS_CACHE_TTL = 3600;

export interface RouteResult {
  distanceMiles: number;
  driveTimeMins: number;
}

export interface OptimiseJob {
  id: string;
  lat: number;
  lng: number;
  appointmentTime?: Date; // anchored time constraint
}

export interface OptimisedLeg {
  jobId: string;
  sequence: number;
  driveFromPrevMins: number;
  driveFromPrevMiles: number;
}

@Injectable()
export class OrsService {
  private readonly logger = new Logger(OrsService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.apiKey = this.config.get<string>('ors.apiKey') ?? '';
    this.baseUrl =
      this.config.get<string>('ors.baseUrl') ??
      'https://api.openrouteservice.org/v2';
  }

  async getRoute(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
  ): Promise<RouteResult | null> {
    const cacheKey = `ors:${fromLat.toFixed(5)},${fromLng.toFixed(5)}:${toLat.toFixed(5)},${toLng.toFixed(5)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as RouteResult;

    try {
      const res = await axios.post(
        `${this.baseUrl}/directions/driving-car/json`,
        {
          coordinates: [
            [fromLng, fromLat],
            [toLng, toLat],
          ],
          units: 'mi',
        },
        {
          headers: {
            Authorization: this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json, application/geo+json',
          },
          timeout: 10_000,
        },
      );

      const summary = (res.data as any).routes?.[0]?.summary;
      if (!summary) return null;

      const result: RouteResult = {
        distanceMiles: Math.round(summary.distance * 100) / 100,
        driveTimeMins: Math.ceil(summary.duration / 60),
      };

      await this.redis.set(cacheKey, JSON.stringify(result), ORS_CACHE_TTL);
      return result;
    } catch (error: any) {
      this.logger.error(`ORS route error: ${error.message}`);
      return null;
    }
  }

  /**
   * Multi-stop optimisation via ORS /optimization endpoint.
   * Returns jobs in optimised order with drive times between legs.
   * Falls back to time-order if ORS fails.
   */
  async optimise(
    startLat: number,
    startLng: number,
    jobs: OptimiseJob[],
  ): Promise<OptimisedLeg[]> {
    if (jobs.length === 0) return [];
    if (jobs.length === 1) {
      const route = await this.getRoute(
        startLat,
        startLng,
        jobs[0].lat,
        jobs[0].lng,
      );
      return [
        {
          jobId: jobs[0].id,
          sequence: 1,
          driveFromPrevMins: route?.driveTimeMins ?? 0,
          driveFromPrevMiles: route?.distanceMiles ?? 0,
        },
      ];
    }

    try {
      // Build ORS optimization request
      const vehicles = [
        {
          id: 1,
          profile: 'driving-car',
          start: [startLng, startLat],
          end: [startLng, startLat],
        },
      ];

      const orsJobs = jobs.map((j, i) => {
        const job: any = {
          id: i + 1,
          location: [j.lng, j.lat],
          service: 0,
        };
        // Anchor jobs with fixed appointment times as time windows
        if (j.appointmentTime) {
          const ts = Math.floor(j.appointmentTime.getTime() / 1000);
          job.time_windows = [[ts - 600, ts + 600]]; // ±10 min window
        }
        return job;
      });

      const res = await axios.post(
        `${this.baseUrl}/optimization`,
        { jobs: orsJobs, vehicles },
        {
          headers: {
            Authorization: this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        },
      );

      const steps = (res.data as any).routes?.[0]?.steps;
      if (!steps || steps.length === 0) throw new Error('No steps returned');

      // Extract job steps (skip start/end)
      const jobSteps = steps.filter((s: any) => s.type === 'job');
      const result: OptimisedLeg[] = [];

      for (let i = 0; i < jobSteps.length; i++) {
        const step = jobSteps[i];
        const jobIndex = step.id - 1; // ORS job IDs are 1-based
        const job = jobs[jobIndex];
        if (!job) continue;

        // Get drive time from previous point
        let driveMins = 0;
        let driveMiles = 0;
        if (i === 0) {
          const route = await this.getRoute(
            startLat,
            startLng,
            job.lat,
            job.lng,
          );
          driveMins = route?.driveTimeMins ?? 0;
          driveMiles = route?.distanceMiles ?? 0;
        } else {
          const prevJob = jobs[jobSteps[i - 1].id - 1];
          if (prevJob) {
            const route = await this.getRoute(
              prevJob.lat,
              prevJob.lng,
              job.lat,
              job.lng,
            );
            driveMins = route?.driveTimeMins ?? 0;
            driveMiles = route?.distanceMiles ?? 0;
          }
        }

        result.push({
          jobId: job.id,
          sequence: i + 1,
          driveFromPrevMins: driveMins,
          driveFromPrevMiles: driveMiles,
        });
      }

      return result;
    } catch (error: any) {
      this.logger.warn(
        `ORS optimise failed, falling back to time-order: ${error.message}`,
      );
      return this.fallbackTimeOrder(startLat, startLng, jobs);
    }
  }

  private async fallbackTimeOrder(
    startLat: number,
    startLng: number,
    jobs: OptimiseJob[],
  ): Promise<OptimisedLeg[]> {
    // Sort by appointment time
    const sorted = [...jobs].sort((a, b) => {
      const ta = a.appointmentTime?.getTime() ?? 0;
      const tb = b.appointmentTime?.getTime() ?? 0;
      return ta - tb;
    });

    const result: OptimisedLeg[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const job = sorted[i];
      const prevLat = i === 0 ? startLat : sorted[i - 1].lat;
      const prevLng = i === 0 ? startLng : sorted[i - 1].lng;
      const route = await this.getRoute(prevLat, prevLng, job.lat, job.lng);

      result.push({
        jobId: job.id,
        sequence: i + 1,
        driveFromPrevMins: route?.driveTimeMins ?? 0,
        driveFromPrevMiles: route?.distanceMiles ?? 0,
      });
    }
    return result;
  }
}
