import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CittService } from './citt.service';
import { CittCheckDto } from './dto/citt-check.dto';

@ApiTags('CITT')
@ApiBearerAuth()
@Controller('citt')
@UseGuards(AuthGuard)
@Throttle({ default: { ttl: 60000, limit: 20 } })
export class CittController {
  constructor(private readonly citt: CittService) {}

  @Post('check')
  @ApiOperation({
    summary: 'Run a "Can I Take This?" profitability check on a potential job',
  })
  @ApiResponse({
    status: 200,
    description:
      'Profitability verdict with breakdown (drive time, mileage, net profit, hourly rate)',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (20 req/min)' })
  async check(@CurrentUser('id') userId: string, @Body() dto: CittCheckDto) {
    const result = await this.citt.runCheck(userId, dto);
    return { success: true, data: result };
  }
}
