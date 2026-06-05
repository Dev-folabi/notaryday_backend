import { REQUIRED_PLAN_KEY } from '../guards/plan.guard';
import { PlanTier } from '../../../generated/prisma';

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
