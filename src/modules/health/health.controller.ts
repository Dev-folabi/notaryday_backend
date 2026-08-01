import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RedisService } from '../../config/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
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
    // Best-effort Redis probe. Always return 200 so an infrastructure
    // health-check never restarts the app just because Redis is down.
    let redis: 'up' | 'down' = 'up';
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
    return { status: 'ok', redis, timestamp: new Date().toISOString() };
  }
}
