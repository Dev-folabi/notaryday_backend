import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlanGuard } from '../../common/guards/plan.guard';
import { Public } from '../../common/decorators/public.decorator';
import { RequiresPro } from '../../common/decorators/requires-pro.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CalendarService } from './calendar.service';
import * as crypto from 'crypto';

@ApiTags('Calendar')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get(':token/feed.ics')
  @Public()
  @ApiOperation({ summary: 'Get iCal feed (public, token-authenticated)' })
  @ApiParam({
    name: 'token',
    description: 'Feed token (obtained from /calendar/feed-token)',
  })
  @ApiResponse({
    status: 200,
    description: 'iCalendar (.ics) file',
    content: { 'text/calendar': {} },
  })
  @ApiResponse({ status: 404, description: 'Invalid feed token' })
  async getFeed(@Param('token') token: string, @Res() res: Response) {
    const ics = await this.calendar.generateFeed(token);
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="notaryday.ics"',
    });
    res.send(ics);
  }

  @Get('feed-token')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get or create iCal feed token for subscription URL',
  })
  @ApiResponse({ status: 200, description: 'Feed token and subscription URL' })
  async getFeedToken(@CurrentUser('id') userId: string) {
    const token = await this.calendar.getOrCreateFeedToken(userId);
    return {
      success: true,
      data: { token, url: `/api/v1/calendar/${token}/feed.ics` },
    };
  }

  @Delete('disconnect')
  @UseGuards(AuthGuard, PlanGuard)
  @RequiresPro()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect Google Calendar' })
  @ApiResponse({ status: 200, description: 'Google Calendar disconnected' })
  async disconnect(@CurrentUser('id') userId: string) {
    const result = await this.calendar.disconnect(userId);
    return { success: true, data: result };
  }

  @Get('auth/google')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Initiate Google Calendar OAuth flow (redirects to Google)',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Google OAuth consent screen',
  })
  async googleAuth(@CurrentUser('id') userId: string, @Res() res: Response) {
    const nonce = crypto.randomBytes(16).toString('hex');
    await this.calendar.storeOAuthState(nonce, userId);

    res.cookie('oauth_nonce', nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    const url = this.calendar.getGoogleAuthUrl(nonce);
    res.redirect(url);
  }

  @Get('auth/google/url')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Google Calendar OAuth URL (returns JSON, no redirect)',
  })
  @ApiResponse({
    status: 200,
    description: 'Google OAuth URL for calendar connection',
  })
  async getGoogleAuthUrl(@CurrentUser('id') userId: string) {
    const nonce = crypto.randomBytes(16).toString('hex');
    await this.calendar.storeOAuthState(nonce, userId);

    const url = this.calendar.getGoogleAuthUrl(nonce);
    return { success: true, data: { url } };
  }

  @Get('auth/google/callback')
  @Public()
  @ApiExcludeEndpoint()
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader.split(';').reduce(
      (acc, cookieStr) => {
        const [key, val] = cookieStr.split('=').map((c) => c.trim());
        if (key && val) acc[key] = val;
        return acc;
      },
      {} as Record<string, string>,
    );

    const oauthNonce = cookies['oauth_nonce'];
    const frontendUrl = process.env.APP_URL ?? 'http://localhost:3000';

    // CSRF check: verify state matches cookie if cookie is present
    if (oauthNonce && oauthNonce !== state) {
      return res.redirect(`${frontendUrl}/settings?calendar=error&reason=csrf`);
    }

    const userId = await this.calendar.getUserIdFromOAuthState(state);
    if (!userId) {
      return res.redirect(
        `${frontendUrl}/settings?calendar=error&reason=expired`,
      );
    }

    await this.calendar.handleGoogleCallback(code, userId);
    res.clearCookie('oauth_nonce');
    res.redirect(`${frontendUrl}/settings?calendar=connected`);
  }
}
