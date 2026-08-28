import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JobImportController } from './job-import.controller';
import { JobImportService } from './job-import.service';
import { JobExtractionService } from './extraction/job-extraction.service';
import { EmailExtractor } from './extraction/email.extractor';
import { OCRExtractor } from './extraction/ocr.extractor';
import { RuleExtractor } from './extraction/rule.extractor';
import { GeminiExtractor } from './extraction/gemini.extractor';
import { OpenRouterExtractor } from './extraction/openrouter.extractor';
import { QUEUE_JOB_IMPORT } from '../../queues/queue.constants';
import { UsersModule } from '../users/users.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_JOB_IMPORT }),
    UsersModule,
    JobsModule,
  ],
  controllers: [JobImportController],
  providers: [
    JobImportService,
    JobExtractionService,
    EmailExtractor,
    OCRExtractor,
    RuleExtractor,
    GeminiExtractor,
    OpenRouterExtractor,
  ],
  exports: [JobImportService, JobExtractionService],
})
export class JobImportModule {}
