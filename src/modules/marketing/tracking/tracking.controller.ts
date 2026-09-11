import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { TrackingService } from './tracking.service';
import { TRACKING_PIXEL_GIF } from '../campaigns/email-compose.util';

const FALLBACK_URL = 'https://www.notaryday.app';

function unsubPage(ok: boolean): string {
  const title = ok ? "You're unsubscribed" : 'Link expired';
  const body = ok
    ? 'You will not receive any further marketing emails from NotaryDay.'
    : 'This unsubscribe link is invalid or has expired. If you keep receiving emails you did not ask for, reply with "unsubscribe" and we will remove you immediately.';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f8fafc;color:#1f2937;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:40px;max-width:420px;margin:24px;text-align:center}
h1{font-size:20px;margin:0 0 12px;color:#0f2c4e}p{font-size:14px;line-height:1.6;color:#475569;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

/**
 * Public tracking endpoints — no auth (email clients can't authenticate).
 * Generous throttles; handlers are idempotent and never leak data.
 */
@ApiTags('Marketing Tracking')
@Controller('marketing')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Public()
  @SkipThrottle()
  @Get('t/:id.gif')
  @HttpCode(200)
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-store, max-age=0')
  @ApiOperation({ summary: 'Open tracking pixel (1x1 gif)' })
  async pixel(@Param('id') id: string) {
    await this.tracking.recordOpen(id).catch(() => undefined);
    return TRACKING_PIXEL_GIF;
  }

  @Public()
  @SkipThrottle()
  @Get('c/:id')
  @ApiOperation({ summary: 'Click tracking redirect' })
  async click(
    @Param('id') id: string,
    @Query('u') target: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.tracking
      .recordClick(id, target, FALLBACK_URL)
      .catch(() => FALLBACK_URL);
    return res.redirect(302, url);
  }

  @Public()
  @Throttle({ default: { limit: 1000, ttl: 60_000 } })
  @Get('u/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Unsubscribe page (link click)' })
  async unsubPage(@Param('token') token: string) {
    const ok = await this.tracking.unsubscribe(token).catch(() => false);
    return unsubPage(ok);
  }

  @Public()
  @Throttle({ default: { limit: 1000, ttl: 60_000 } })
  @Post('u/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary: 'RFC 8058 one-click unsubscribe (List-Unsubscribe-Post)',
  })
  async unsubOneClick(@Param('token') token: string) {
    const ok = await this.tracking.unsubscribe(token).catch(() => false);
    return unsubPage(ok);
  }
}
