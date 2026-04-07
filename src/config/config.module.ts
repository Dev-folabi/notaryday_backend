import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validationSchema } from './validation.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [() => ({})],
      validationSchema,
      isGlobal: true,
      cache: true,
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}