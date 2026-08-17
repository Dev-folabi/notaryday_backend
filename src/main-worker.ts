import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker-app.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerAppModule);
  new Logger('WorkerBootstrap').log('Notary Day workers running');
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
