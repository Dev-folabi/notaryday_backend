import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const auth = { isTokenBlacklisted: jest.fn(), getMeFromToken: jest.fn() };
  const guard = new AuthGuard(reflector as never, auth as never);
  const context = (authorization?: string) => {
    const request = { headers: { authorization } };
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
      request,
    };
  };

  beforeEach(() => jest.clearAllMocks());

  it('allows explicitly public routes', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(context() as never)).resolves.toBe(true);
  });

  it('rejects missing bearer tokens', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    await expect(guard.canActivate(context() as never)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches the authenticated user', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    auth.isTokenBlacklisted.mockResolvedValue(false);
    auth.getMeFromToken.mockResolvedValue({ id: 'u1' });
    const ctx = context('Bearer token');
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
    expect((ctx.request as { user?: unknown }).user).toEqual({ id: 'u1' });
  });
});
