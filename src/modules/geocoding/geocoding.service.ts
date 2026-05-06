import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';

/** 30 days in seconds */
const GEOCODE_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Nominatim rate-limit: 1 request per second */
const NOMINATIM_DELAY_MS = 1100;

export interface GeoPoint {
  lat: number;
  lng: number;
  source: 'redis' | 'db' | 'nominatim';
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private lastNominatimCallAt = 0;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolve an address string to lat/lng.
   * Check order: Redis → DB → Nominatim (rate-limited).
   */
  async geocode(address: string): Promise<GeoPoint | null> {
    const normalised = this.normalise(address);
    const cacheKey = this.cacheKey(normalised);

    // Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { lat: number; lng: number };
      this.logger.debug(`[Geocode] Redis hit for "${normalised}"`);
      return { ...parsed, source: 'redis' };
    }

    // DB cache fallback
    const dbRecord = await this.prisma.geocodeCache.findUnique({
      where: { address_normalised: normalised },
    });
    if (dbRecord) {
      const point: GeoPoint = {
        lat: Number(dbRecord.lat),
        lng: Number(dbRecord.lng),
        source: 'db',
      };
      // Warm up Redis
      await this.redis.set(
        cacheKey,
        JSON.stringify({ lat: point.lat, lng: point.lng }),
        GEOCODE_TTL_SECONDS,
      );
      // Bump hit count
      await this.prisma.geocodeCache.update({
        where: { id: dbRecord.id },
        data: { hit_count: { increment: 1 }, last_used_at: new Date() },
      });
      this.logger.debug(`[Geocode] DB hit for "${normalised}"`);
      return point;
    }

    // Nominatim (rate-limited)
    const point = await this.callNominatim(normalised);
    if (!point) return null;

    // Store in both caches
    await this.redis.set(
      cacheKey,
      JSON.stringify({ lat: point.lat, lng: point.lng }),
      GEOCODE_TTL_SECONDS,
    );
    await this.prisma.geocodeCache.upsert({
      where: { address_normalised: normalised },
      create: {
        address_normalised: normalised,
        lat: point.lat,
        lng: point.lng,
        source: 'nominatim',
      },
      update: {
        lat: point.lat,
        lng: point.lng,
        hit_count: { increment: 1 },
        last_used_at: new Date(),
      },
    });

    return { ...point, source: 'nominatim' };
  }

  // Helpers

  private normalise(address: string): string {
    return address.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private cacheKey(normalised: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(normalised)
      .digest('hex')
      .slice(0, 16);
    return `geocode:${hash}`;
  }

  private async callNominatim(
    query: string,
  ): Promise<{ lat: number; lng: number } | null> {
    // Enforce 1 req/sec rate limit
    const now = Date.now();
    const elapsed = now - this.lastNominatimCallAt;
    if (elapsed < NOMINATIM_DELAY_MS) {
      await this.sleep(NOMINATIM_DELAY_MS - elapsed);
    }
    this.lastNominatimCallAt = Date.now();

    const appUrl = this.config.get<string>('app.url') ?? 'notaryday.app';

    try {
      const response = await axios.get(
        'https://nominatim.openstreetmap.org/search',
        {
          params: { q: query, format: 'json', limit: 1 },
          headers: {
            'User-Agent': `NotaryDay/1.0 (${appUrl})`,
            Accept: 'application/json',
          },
          timeout: 10_000,
        },
      );

      const results = response.data as { lat: string; lon: string }[];

      if (!results.length) {
        this.logger.warn(`[Geocode] No Nominatim result for "${query}"`);
        return null;
      }

      return {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Geocode] Nominatim error: ${msg}`);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
