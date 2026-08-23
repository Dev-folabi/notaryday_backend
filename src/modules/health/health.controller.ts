import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RedisService } from '../../config/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private cachedRedis: 'up' | 'down' | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(private readonly redis: RedisService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      properties: {
        status: { type: 'string', example: 'ok' },
        redis: { type: 'string', example: 'up' },
        timestamp: { type: 'string', example: '2025-06-01T12:00:00.000Z' },
      },
    },
  })
  async check() {
    let redis: 'up' | 'down' = 'up';
    const now = Date.now();
    if (
      this.cachedRedis &&
      now - this.cachedAt < HealthController.CACHE_TTL_MS
    ) {
      redis = this.cachedRedis;
    } else {
      try {
        await Promise.race([
          this.redis.ping(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('redis ping timed out after 3s')),
              3000,
            ),
          ),
        ]);
      } catch {
        redis = 'down';
      }
      this.cachedRedis = redis;
      this.cachedAt = now;
    }
    return { status: 'ok', redis, timestamp: new Date().toISOString() };
  }
}
