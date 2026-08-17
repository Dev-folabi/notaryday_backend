/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BotBlockMiddleware } from './bot-block.middleware';

describe('BotBlockMiddleware', () => {
  let middleware: BotBlockMiddleware;
  let configGet: jest.Mock;

  const createMiddleware = async (overrides: Record<string, string> = {}) => {
    const values: Record<string, string> = {
      BOT_BLOCK_ENABLED: 'true',
      BOT_BLOCK_MODE: 'LIVE',
      BOT_BLOCK_REQUIRE_UA: 'true',
      BOT_BLOCK_EXTRA_UA: '',
      ...overrides,
    };
    configGet = jest.fn((key: string) => values[key]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotBlockMiddleware,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    middleware = module.get<BotBlockMiddleware>(BotBlockMiddleware);
  };

  const makeRequest = (
    userAgent: string | null,
    opts: { path?: string; authorization?: string } = {},
  ) => ({
    path: opts.path ?? '/api/v1/auth/login',
    url: opts.path ?? '/api/v1/auth/login',
    method: 'POST',
    ip: '1.2.3.4',
    headers: {
      ...(userAgent !== null ? { 'user-agent': userAgent } : {}),
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
    },
    get: (header: string) =>
      header === 'user-agent' ? userAgent : (opts.authorization ?? undefined),
  });

  const makeResponse = () => {
    const res: any = {
      statusCode: 200,
      body: null,
      status: jest.fn(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn(function (this: any, body: unknown) {
        this.body = body;
        return this;
      }),
    };
    return res;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await createMiddleware();
  });

  it('allows a normal browser user agent', () => {
    const next = jest.fn();
    middleware.use(
      makeRequest(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0',
      ) as any,
      makeResponse() as any,
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('blocks a blacklisted automation user agent with BOT_BLOCKED 403', () => {
    const req = makeRequest('curl/8.5.0') as any;
    const res = makeResponse() as any;
    const next = jest.fn();
    middleware.use(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BOT_BLOCKED');
  });

  it('blocks requests with no user agent when BOT_BLOCK_REQUIRE_UA is on', () => {
    const res = makeResponse() as any;
    middleware.use(makeRequest(null) as any, res as any, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('lets missing user agent through when BOT_BLOCK_REQUIRE_UA is off', async () => {
    await createMiddleware({ BOT_BLOCK_REQUIRE_UA: 'false' });
    const next = jest.fn();
    middleware.use(makeRequest(null) as any, makeResponse() as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('does not enforce in DRY_RUN mode (logs and continues)', async () => {
    await createMiddleware({ BOT_BLOCK_MODE: 'DRY_RUN' });
    const res = makeResponse() as any;
    const next = jest.fn();
    middleware.use(makeRequest('curl/8.5.0') as any, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('skips protected server-to-server paths', () => {
    const next = jest.fn();
    middleware.use(
      makeRequest('curl/8.5.0', { path: '/api/v1/health' }) as any,
      makeResponse() as any,
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('skips requests carrying a Bearer token', () => {
    const next = jest.fn();
    middleware.use(
      makeRequest('curl/8.5.0', { authorization: 'Bearer abc' }) as any,
      makeResponse() as any,
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('is fully disabled when BOT_BLOCK_ENABLED is false', async () => {
    await createMiddleware({ BOT_BLOCK_ENABLED: 'false' });
    const next = jest.fn();
    middleware.use(
      makeRequest('curl/8.5.0') as any,
      makeResponse() as any,
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('honors extra blacklist patterns from BOT_BLOCK_EXTRA_UA', async () => {
    await createMiddleware({ BOT_BLOCK_EXTRA_UA: 'my-scraper,evil-bot' });
    const res = makeResponse() as any;
    middleware.use(makeRequest('My-Scraper/1.0') as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
