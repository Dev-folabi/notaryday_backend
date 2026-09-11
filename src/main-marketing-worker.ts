import 'dotenv/config';
import './instrument';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MarketingWorkerAppModule } from './marketing-worker-app.module';
import { Sentry } from './instrument';

// Entry point for the marketing worker process (no HTTP server).
// Consumes QUEUE_MARKETING: spreadsheet imports, campaign sends, tracking.
// Connects to MongoDB only — never Postgres/Prisma.
async function bootstrap() {
  await NestFactory.createApplicationContext(MarketingWorkerAppModule);
  new Logger('MarketingWorkerBootstrap').log(
    'Notary Day marketing worker running',
  );
}

async function shutdown(signal: string) {
  new Logger('MarketingWorkerBootstrap').log(
    `Received ${signal}, shutting down...`,
  );
  await Sentry.close(2000);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

bootstrap().catch(async (error) => {
  Sentry.captureException(error);
  await Sentry.close(2000);
  console.error(error);
  process.exit(1);
});
