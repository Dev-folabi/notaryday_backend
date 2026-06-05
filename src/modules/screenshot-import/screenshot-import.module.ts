import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScreenshotImportController } from './screenshot-import.controller';
import { ScreenshotImportService } from './screenshot-import.service';
import { QUEUE_SCREENSHOT_IMPORT } from '../../queues/queue.constants';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_SCREENSHOT_IMPORT })],
  controllers: [ScreenshotImportController],
  providers: [ScreenshotImportService],
})
export class ScreenshotImportModule {}
