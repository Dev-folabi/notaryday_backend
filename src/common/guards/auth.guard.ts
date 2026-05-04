import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
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

    if (await this.authService.isTokenBlacklisted(token)) {
      throw new UnauthorizedException('Session expired, please login');
    }

    try {
      const user = await this.authService.getMeFromToken(token);
      (request as RequestWithUser).user = user as User;
      return true;
    } catch (e) {
      console.error('AuthGuard authentication failed:', e);
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        throw e;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
