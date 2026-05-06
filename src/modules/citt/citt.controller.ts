import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CittService } from './citt.service';
import { CittCheckDto } from './dto/citt-check.dto';

@Controller('citt')
@UseGuards(AuthGuard)
export class CittController {
  constructor(private readonly citt: CittService) {}

  /** POST /api/v1/citt/check */
  @Post('check')
  async check(@CurrentUser('id') userId: string, @Body() dto: CittCheckDto) {
    const result = await this.citt.runCheck(userId, dto);
    return { success: true, data: result };
  }
}
