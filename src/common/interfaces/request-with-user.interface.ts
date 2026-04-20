import { PlanTier } from '../../../generated/prisma';

export interface RequestWithUser {
  user: {
    id: string;
    email: string;
    full_name?: string;
    plan: PlanTier;
  };
  params: {
    id?: string;
    [key: string]: any;
  };
}
