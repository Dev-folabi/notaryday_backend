import { Injectable, Logger, Optional } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import * as path from 'path';
import * as os from 'os';
import { withTimeout } from './timeout.util';

/**
 * Tesseract OCR with sharp preprocessing (grayscale, resize, contrast boost).
 *
 * Screenshots are downscaled to at most 1600px and run through a single shared
 * worker serialized behind a mutex so OCR jobs never pile up and OOM the worker
 * process.
 *
 * Robustness: tesseract.js's createWorker can return a promise that NEVER
 * settles (language-data download failure, unwritable cache). Every await here
 * is wrapped in a hard timeout so a hung OCR can never block a job import —
 * the caller falls back to AI vision instead.
 */
@Injectable()
export class OCRExtractor {
  private readonly logger = new Logger(OCRExtractor.name);

  private readonly MAX_DIMENSION = 1600;
  private readonly workerCreateTimeoutMs: number;
  private readonly recognizeTimeoutMs: number;

  private busy: Promise<unknown> = Promise.resolve();
  private worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  private workerPromise: Promise<
    Awaited<ReturnType<typeof createWorker>>
  > | null = null;

  constructor(
    @Optional()
    options?: {
      workerCreateTimeoutMs?: number;
      recognizeTimeoutMs?: number;
    },
  ) {
    this.workerCreateTimeoutMs = options?.workerCreateTimeoutMs ?? 60_000;
    this.recognizeTimeoutMs = options?.recognizeTimeoutMs ?? 30_000;
  }

  async extractText(imageBuffer: Buffer): Promise<string> {
    const processed = await this.preprocess(imageBuffer);

    // Serialize OCR: one at a time on a single core.
    const run = this.busy.then(async () => {
      try {
        const worker = await this.getWorker();
        const result = await withTimeout(
          worker.recognize(processed),
          this.recognizeTimeoutMs,
          'OCR recognition timed out',
        );
        return result.data.text ?? '';
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
    if (this.workerPromise) return this.workerPromise;

    this.logger.log('Initializing Tesseract OCR worker (eng)...');
    this.workerPromise = withTimeout(
      createWorker('eng', 1, {
        // Cache traineddata in the OS temp dir so it is always writable
        // (the container runs as a non-root user with a root-owned /app).
        cachePath:
          process.env.TESSERACT_CACHE_PATH ||
          path.join(os.tmpdir(), 'tesseract-cache'),
        cacheMethod: 'update',
      }),
      this.workerCreateTimeoutMs,
      'Tesseract worker creation timed out (traineddata download may be blocked)',
    )
      .then((worker) => {
        this.worker = worker;
        return worker;
      })
      .catch((err) => {
        // Allow a later call to retry worker creation from scratch.
        this.workerPromise = null;
        this.logger.warn(
          `Tesseract worker creation failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      });

    return this.workerPromise;
  }
}
