import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_PRO_KEY } from '../decorators/requires-pro.decorator';
import { UsersService } from '../../modules/users/users.service';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiresPro = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_PRO_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiresPro) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ session?: { userId?: string } }>();
    const userId = request.session?.userId;

    if (!userId) {
      return true; // AuthGuard will handle this
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      return true;
    }

    const proPlans = ['PRO', 'PRO_ANNUAL'];
    if (proPlans.includes(user.plan)) {
      return true;
    }

    throw new ForbiddenException(
      'This feature is available on the Pro plan. Upgrade to access.',
    );
  }
}
