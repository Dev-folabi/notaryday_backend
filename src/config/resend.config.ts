import { Resend } from 'resend';

export const createResendClient = (apiKey: string): Resend => {
  return new Resend(apiKey);
};
