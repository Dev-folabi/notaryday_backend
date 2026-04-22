import { PlanTier } from '../../../generated/prisma';
import { Request } from 'express';

export interface RequestWithUser extends Request {
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
