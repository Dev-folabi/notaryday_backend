import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanTier } from '../../../generated/prisma';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

export const REQUIRED_PLAN_KEY = 'requiredPlan';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPlan = this.reflector.getAllAndOverride<PlanTier[]>(
      REQUIRED_PLAN_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPlan) {
      // No plan required, allow access
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // Check if user has required plan
    // Handle both PRO and PRO_ANNUAL as valid Pro plans
    const isProPlan =
      user.plan === PlanTier.PRO || user.plan === PlanTier.PRO_ANNUAL;

    if (requiredPlan.includes(PlanTier.PRO) && isProPlan) {
      return true;
    }

    // If specifically requiring FREE plan
    if (
      requiredPlan.length === 1 &&
      requiredPlan[0] === PlanTier.FREE &&
      user.plan === PlanTier.FREE
    ) {
      return true;
    }

    throw new ForbiddenException('Pro subscription required');
  }
}

// Decorator for marking routes as Pro-only
export const RequiresPro = () => {
  return (target: object, propertyKey?: string | symbol) => {
    if (propertyKey) {
      Reflect.defineMetadata(
        REQUIRED_PLAN_KEY,
        [PlanTier.PRO],
        target,
        propertyKey,
      );
    } else {
      Reflect.defineMetadata(REQUIRED_PLAN_KEY, [PlanTier.PRO], target);
    }
  };
};
