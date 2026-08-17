import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const users = {
    findByEmail: jest.fn(),
    validatePassword: jest.fn(),
    updateLastSeen: jest.fn(),
  };
  const jwt = { sign: jest.fn().mockReturnValue('jwt') };
  const service = new AuthService(
    users as never,
    {} as never,
    {} as never,
    jwt as never,
    {} as never,
    { track: jest.fn() } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects invalid credentials without leaking which field failed', async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(service.login('x@example.com', 'bad')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('returns a JWT without the password hash', async () => {
    users.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'x@example.com',
      password_hash: 'secret',
      username: 'x',
    });
    users.validatePassword.mockResolvedValue(true);
    const result = await service.login('x@example.com', 'valid');
    expect(result).toEqual({
      user: { id: 'u1', email: 'x@example.com', username: 'x' },
      token: 'jwt',
    });
  });
});
