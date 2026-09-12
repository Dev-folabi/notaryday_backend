import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../config/prisma.module';
import { TransactionalEmailService } from './transactional-email.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [TransactionalEmailService],
  exports: [TransactionalEmailService],
})
export class TransactionalEmailModule {}
