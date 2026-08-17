import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

/**
 * Blacklist-based bot protection.
 *
 * Guards unauthenticated human-facing endpoints (auth, public booking page,
 * username checks) against known automation frameworks and scrapers. Requests
 * carrying a Bearer token are already gated by the AuthGuard, and server-to-
 * server callers (webhooks, health checks, OAuth callbacks, ICS feeds) are
 * explicitly skipped.
 *
 * Behavior is env-driven:
 *  - BOT_BLOCK_ENABLED   (bool,  default true)  master switch
 *  - BOT_BLOCK_MODE      (DRY_RUN | LIVE, default LIVE)  log-only vs enforce
 *  - BOT_BLOCK_REQUIRE_UA (bool,  default true)  block requests with no User-Agent
 *  - BOT_BLOCK_EXTRA_UA  (csv of regex)          extra blacklist patterns
 */
@Injectable()
export class BotBlockMiddleware implements NestMiddleware {
  private readonly logger = new Logger('BotBlock');
  private readonly enabled: boolean;
  private readonly dryRun: boolean;
  private readonly requireUserAgent: boolean;
  private readonly patterns: RegExp[];

  private static readonly SKIP_PATH_PATTERNS: RegExp[] = [
    /^\/(api\/v1\/)?health$/,
    /\/billing\/webhook/,
    /\/imports\/inbound/,
    /\/calendar\/auth\/google\/callback/,
    /\/calendar\/[^/]+\/feed\.ics$/,
  ];

  private static readonly DEFAULT_BLACKLIST: RegExp[] = [
    /^curl\//i,
    /^wget/i,
    /python-requests/i,
    /python-urllib/i,
    /^aiohttp/i,
    /^httpx/i,
    /^python/i,
    /^java\//i,
    /okhttp/i,
    /apache-httpclient/i,
    /libwww-perl/i,
    /^scrapy/i,
    /^ruby/i,
    /^mechanize/i,
    /phantomjs/i,
    /headlesschrome/i,
    /^selenium/i,
    /puppeteer/i,
    /playwright/i,
    /postmanruntime/i,
    /^postman/i,
    /^insomnia/i,
    /burp suite/i,
    /^nikto/i,
    /^sqlmap/i,
    /^masscan/i,
    /^nmap/i,
    /^zgrab/i,
    /metasploit/i,
    /apachebench/i,
    /^hey\//i,
    /artillery/i,
    /^vegeta/i,
    /^gatling/i,
    /^jmeter/i,
    /^httpie/i,
    /^go-http-client/i,
    /node-fetch/i,
    /^axios\//i,
  ];

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('BOT_BLOCK_ENABLED') !== 'false';
    this.dryRun =
      (this.config.get<string>('BOT_BLOCK_MODE') ?? 'LIVE').toUpperCase() ===
      'DRY_RUN';
    this.requireUserAgent =
      this.config.get<string>('BOT_BLOCK_REQUIRE_UA') !== 'false';

    this.patterns = [...BotBlockMiddleware.DEFAULT_BLACKLIST];

    const extra = this.config.get<string>('BOT_BLOCK_EXTRA_UA');
    if (extra) {
      for (const raw of extra.split(',')) {
        const pattern = raw.trim();
        if (!pattern) continue;
        try {
          this.patterns.push(new RegExp(pattern, 'i'));
        } catch (err) {
          this.logger.warn(
            `Ignoring invalid BOT_BLOCK_EXTRA_UA pattern "${pattern}": ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }

  use(request: Request, response: Response, next: NextFunction): void {
    if (!this.enabled) {
      return next();
    }

    // Authenticated routes are protected by the AuthGuard; let them through.
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return next();
    }

    if (BotBlockMiddleware.isSkippedPath(request.path)) {
      return next();
    }

    const userAgent = request.get('user-agent') || '';
    const ip = request.ip ?? 'unknown';

    if (this.requireUserAgent && !userAgent) {
      return this.reject(
        request,
        response,
        next,
        ip,
        'Missing User-Agent header',
      );
    }

    const match = this.patterns.find((pattern) => pattern.test(userAgent));
    if (match) {
      return this.reject(
        request,
        response,
        next,
        ip,
        `Blocked user agent: ${userAgent.slice(0, 120)}`,
        match,
      );
    }

    next();
  }

  private reject(
    request: Request,
    response: Response,
    next: NextFunction,
    ip: string,
    detail: string,
    pattern?: RegExp,
  ): void {
    if (this.dryRun) {
      this.logger.warn(
        `[DRY_RUN] would block ${request.method} ${request.path} from ${ip}: ${detail}`,
      );
      return next();
    }

    this.logger.warn(
      `Blocked ${request.method} ${request.path} from ${ip}: ${detail}${
        pattern ? ` (matched /${pattern.source}/)` : ''
      }`,
    );

    const errorResponse = {
      code: 'BOT_BLOCKED',
      message: 'Access denied: automated request blocked',
      statusCode: 403,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(403).json({ success: false, error: errorResponse });
  }

  private static isSkippedPath(path: string): boolean {
    return BotBlockMiddleware.SKIP_PATH_PATTERNS.some((pattern) =>
      pattern.test(path),
    );
  }
}
