import { IsEmail, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendNotificationDto {
  @ApiProperty({
    example: 'notary@example.com',
    description: 'Must match authenticated user email',
  })
  @IsEmail()
  to: string;

  @ApiProperty({ example: 'Job Reminder' })
  @IsString()
  subject: string;

  @ApiProperty({ example: '<h1>Reminder</h1><p>You have a signing at 2pm</p>' })
  @IsString()
  html: string;

  @ApiPropertyOptional({ example: 'Reminder: You have a signing at 2pm' })
  @IsOptional()
  @IsString()
  text?: string;
}
