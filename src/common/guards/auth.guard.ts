import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthService } from '../../modules/auth/auth.service';
import { Prisma, User } from 'generated/prisma';
import { Request } from 'express';

export interface RequestWithUser extends Request {
  user: User;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'] as string;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authHeader.split(' ')[1];

    // Fail open on Redis errors — an unavailable cache must not log users out
    try {
      if (await this.authService.isTokenBlacklisted(token)) {
        throw new UnauthorizedException('Session expired, please login');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      console.error('Blacklist check failed (Redis unavailable):', error);
    }

    try {
      const user = await this.authService.getMeFromToken(token);
      (request as RequestWithUser).user = user as User;
      return true;
    } catch (e) {
      // Genuinely invalid/expired token → 401
      if (e instanceof UnauthorizedException) {
        throw e;
      }
      // Infrastructure failure (DB down, connection error) → 500 so clients
      // don't treat a transient outage as a dead session
      if (
        e instanceof Prisma.PrismaClientKnownRequestError ||
        e instanceof Prisma.PrismaClientInitializationError
      ) {
        console.error('AuthGuard database error:', e);
        throw new InternalServerErrorException(
          'Authentication temporarily unavailable',
        );
      }
      console.error('AuthGuard authentication failed:', e);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
