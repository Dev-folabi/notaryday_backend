import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '../../../generated/prisma/client';

interface ErrorResponse {
  code: string;
  message: string;
  statusCode: number;
  timestamp: string;
  path?: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let code: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        code = this.getCodeFromStatus(status);
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, any>;
        message = (resp.message as string) ?? exception.message;
        code = (resp.code as string) ?? this.getCodeFromStatus(status);
      } else {
        message = exception.message;
        code = this.getCodeFromStatus(status);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = exception;
      switch (prismaError.code) {
        case 'P2000':
          status = HttpStatus.BAD_REQUEST;
          message = 'The provided value for the column is too long.';
          code = 'DATABASE_VALIDATION_ERROR';
          break;
        case 'P2001':
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found.';
          code = 'DATABASE_NOT_FOUND';
          break;
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = `Unique constraint failed on the fields: ${(prismaError.meta?.target as string[])?.join(', ') || 'unknown'}`;
          code = 'DATABASE_CONFLICT';
          break;
        case 'P2003':
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message = 'Foreign key constraint failed.';
          code = 'DATABASE_FOREIGN_KEY_FAILED';
          break;
        case 'ETIMEDOUT':
          status = HttpStatus.GATEWAY_TIMEOUT;
          message = 'Database connection timed out. Please try again later.';
          code = 'DATABASE_TIMEOUT';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          message = 'Database request error.';
          code = `PRISMA_ERROR_${prismaError.code}`;
      }
      this.logger.error(
        `Prisma error ${prismaError.code}: ${prismaError.message}`,
        prismaError.stack,
      );
    } else if (
      exception instanceof Prisma.PrismaClientUnknownRequestError ||
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientValidationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Database error occurred.';
      code = 'DATABASE_ERROR';
      this.logger.error('Unhandled Prisma exception', exception);
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      code = 'INTERNAL_ERROR';
      this.logger.error('Unhandled exception', exception);
    }

    const errorResponse: ErrorResponse = {
      code,
      message: Array.isArray(message) ? message.join(', ') : message,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json({
      success: false,
      error: errorResponse,
    });
  }

  private getCodeFromStatus(status: number): string {
    const codeMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
    };
    return codeMap[status] ?? 'ERROR';
  }
}
