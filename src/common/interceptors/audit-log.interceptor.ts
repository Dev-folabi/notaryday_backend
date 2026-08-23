import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = req;
    const userId =
      (req as Request & { user?: { id?: string } }).user?.id ?? 'anonymous';
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        const status = context
          .switchToHttp()
          .getResponse<Response>().statusCode;

        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
          this.logger.log(
            JSON.stringify({
              userId,
              method,
              url,
              status,
              duration,
              ip,
              ts: new Date().toISOString(),
            }),
          );
        }
      }),
    );
  }
}
