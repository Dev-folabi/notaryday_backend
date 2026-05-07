import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './configuration';
import { validationSchema } from './validation.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      load: configuration,
      validationSchema,
      isGlobal: true,
      cache: true,
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
