import { ConfigService } from '@nestjs/config';
import { BullRootModuleOptions } from '@nestjs/bull';

export const bullRedisConnection = (
  config: ConfigService,
): BullRootModuleOptions => {
  const url = config.get<string>('REDIS_URL');
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (!url) {
    throw new Error('REDIS_URL is not configured');
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
      connectTimeout: 5000,
      keepAlive: 5000,
    } as BullRootModuleOptions['redis'],
    settings: {
      drainDelay: 60,
      guardInterval: 30000,
      stalledInterval: 300000,
    },
  };
};
