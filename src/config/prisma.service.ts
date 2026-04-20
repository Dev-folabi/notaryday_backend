import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('PrismaService');
  private pool: pg.Pool;

  constructor() {
    // ✅ Validate env variable early
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 5,
      min: 0,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
    });

    // ✅ Catch pool-level errors
    pool.on('error', (err) => {
      this.logger.error(`Pool error: ${err.message}`);
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });

    this.pool = pool;
  }

  async onModuleInit() {
    let retries = 5;

    while (retries > 0) {
      try {
        // ✅ Test raw pool connection first
        const client = await this.pool.connect();
        client.release();
        this.logger.log('✅ pg.Pool connected to NeonDB');

        await this.$connect();
        this.logger.log('✅ Prisma connected to NeonDB');
        break;
      } catch (error) {
        const err = error as Error;
        retries--;
        this.logger.error(
          `❌ Connection attempt failed. Retries left: ${retries}`,
        );
        this.logger.error(`   Reason: ${err.message}`);

        if (retries === 0) {
          this.logger.error('All retries exhausted.');
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
    this.logger.log('✅ Database pool closed');
  }
}
