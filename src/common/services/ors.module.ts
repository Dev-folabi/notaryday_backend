import { Global, Module } from '@nestjs/common';
import { OrsService } from './ors.service';

@Global()
@Module({
  providers: [OrsService],
  exports: [OrsService],
})
export class OrsModule {}
