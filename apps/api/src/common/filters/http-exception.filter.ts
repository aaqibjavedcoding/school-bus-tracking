import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse } from '@school-bus-tracking/shared-types';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;

    let errorMessage = 'Internal server error';
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let details: unknown = undefined;

    if (typeof exceptionResponse === 'string') {
      errorMessage = exceptionResponse;
    } else if (exceptionResponse && typeof exceptionResponse === 'object') {
      const respObj = exceptionResponse as Record<string, unknown>;
      errorMessage = (respObj['message'] as string) || errorMessage;
      errorCode = (respObj['error'] as string) || `HTTP_${status}`;
      details = respObj['details'] || undefined;
    } else if (exception instanceof Error) {
      errorMessage = exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} - Status: ${status} - Error: ${errorMessage}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const payload: ApiResponse = {
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
        details,
      },
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(payload);
  }
}
