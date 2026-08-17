import 'dotenv/config';
import './instrument';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker-app.module';
import { Sentry } from './instrument';

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerAppModule);
  new Logger('WorkerBootstrap').log('Notary Day workers running');
}

async function shutdown(signal: string) {
  new Logger('WorkerBootstrap').log(`Received ${signal}, shutting down...`);
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
