import { IsEmail, IsOptional, IsString } from 'class-validator';

export class SendNotificationDto {
  @IsEmail()
  to: string;

  @IsString()
  subject: string;

  @IsString()
  html: string;

  @IsOptional()
  @IsString()
  text?: string;
}
