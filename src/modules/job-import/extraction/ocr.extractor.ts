import { Injectable, Logger } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

/**
 * Tesseract OCR with sharp preprocessing (grayscale, resize, contrast boost).
 *
 * Screenshots are downscaled to at most 1600px
 * and run through a single shared worker serialized behind a mutex so OCR jobs
 * never pile up and OOM the worker process.
 */
@Injectable()
export class OCRExtractor {
  private readonly logger = new Logger(OCRExtractor.name);

  private readonly MAX_DIMENSION = 1600;
  private busy: Promise<unknown> = Promise.resolve();
  private worker: Awaited<ReturnType<typeof createWorker>> | null = null;

  async extractText(imageBuffer: Buffer): Promise<string> {
    const processed = await this.preprocess(imageBuffer);

    // Serialize OCR: one at a time on a single core.
    const run = this.busy.then(async () => {
      const worker = await this.getWorker();
      try {
        const { data } = await worker.recognize(processed);
        return data.text ?? '';
      } finally {
        // Release the mutex so the next queued OCR can start.
        this.busy = Promise.resolve();
      }
    });
    // Never poison the chain: a failed OCR must not reject every future call.
    this.busy = run.catch(() => {});
    return run;
  }

  private async preprocess(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .grayscale()
        .resize({
          width: this.MAX_DIMENSION,
          height: this.MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .normalize()
        .png()
        .toBuffer();
    } catch (err) {
      this.logger.warn(
        `OCR preprocess failed (${err instanceof Error ? err.message : 'unknown'}), using raw image`,
      );
      return buffer;
    }
  }

  private async getWorker(): Promise<Awaited<ReturnType<typeof createWorker>>> {
    if (this.worker) return this.worker;
    this.logger.log('Initializing Tesseract OCR worker (eng)...');
    this.worker = await createWorker('eng', 1, {
      // Cache traineddata on disk so repeated imports don't re-download.
      cachePath: process.env.TESSERACT_CACHE_PATH || '.tesseract-cache',
      cacheMethod: 'update',
    });
    return this.worker;
  }
}
