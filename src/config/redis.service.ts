import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>('UPSTASH_REDIS_URL');
    if (!url) {
      throw new Error('UPSTASH_REDIS_URL is not configured');
    }

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    this.client = new Redis(url, {
      tls: { rejectUnauthorized: isProduction },
      lazyConnect: true,
      // Fail fast instead of queuing commands forever when the connection is
      // down or half-open (e.g. Upstash sleeping idle sockets).
      enableOfflineQueue: false,
      commandTimeout: 5000,
    });

    try {
      await this.client.connect();
      await this.client.ping();
      console.log('[Redis] Connected to Upstash');
    } catch (err) {
      // Don't crash the app when Redis is unreachable at boot — cache calls
      // fail fast (enableOfflineQueue:false) and are guarded at every call
      // site, and BullMQ buffers jobs until it reconnects. Only a missing URL
      // is fatal, above.
      console.warn(
        `[Redis] Failed to connect at boot — cache degraded, queue jobs will buffer: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async delPattern(pattern: string): Promise<void> {
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}
