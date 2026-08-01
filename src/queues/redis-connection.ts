import { ConfigService } from '@nestjs/config';
import { BullRootModuleOptions } from '@nestjs/bull';

export const bullRedisConnection = (
  config: ConfigService,
): BullRootModuleOptions => {
  const url = config.get<string>('UPSTASH_REDIS_URL');
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (!url) {
    throw new Error('UPSTASH_REDIS_URL is not configured');
  }

  const parsed = new URL(url);
  const tls = parsed.protocol === 'rediss:';

  return {
    redis: {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      tls: tls ? { rejectUnauthorized: isProduction } : undefined,
      maxRetriesPerRequest: null,
      // Upstash closes idle sockets and free tiers sleep the DB — fail the
      // connect fast instead of hanging, and probe dead sockets so reconnects
      // are detected quickly. Commands are buffered (offline queue on) and
      // flushed once the connection is re-established.
      connectTimeout: 5000,
      keepAlive: 5000,
    } as BullRootModuleOptions['redis'],
  };
};
