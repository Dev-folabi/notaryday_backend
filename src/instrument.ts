/**
 * Sentry bootstrap. Imported as the very first module in both entry points
 * (main.ts and main-worker.ts) so crashes during application bootstrap are
 * captured too. No-ops (no client) when SENTRY_DSN is not configured.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}

export { Sentry };
