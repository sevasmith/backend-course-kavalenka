import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { isUniqueViolation } from '@/core/database/pg-errors';
import {
  defaultErrorCode,
  ErrorCode,
  ErrorResponseBody,
  isErrorCode,
} from './api-error';

/**
 * 5xx responses never carry the thrown message: it can describe the
 * infrastructure (SMTP, DB, the RBAC policy). `task.md`, "Error Masking".
 */
const NEUTRAL_MESSAGES: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.AUTHORIZATION_UNAVAILABLE]:
    'Authorization is temporarily unavailable',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service is temporarily unavailable',
  [ErrorCode.GATEWAY_TIMEOUT]: 'The operation took too long',
};
const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * Turns every error thrown while handling a request into one response shape:
 * `{ statusCode, code, message }` (registered globally in `AppModule`).
 *
 * - `HttpException`: its status; the code from its response object (see
 *   `apiError`) or the default for the status.
 * - A unique violation that a service didn't map: 409 `conflict`, a safety
 *   net for races between the "is it taken?" check and the insert.
 * - Anything else is a bug: logged with its stack, answered with a neutral
 *   500 that says nothing about the cause.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = this.toResponseBody(exception);
    const { httpAdapter } = this.httpAdapterHost;
    httpAdapter.reply(host.switchToHttp().getResponse(), body, body.statusCode);
  }

  private toResponseBody(exception: unknown): ErrorResponseBody {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (isUniqueViolation(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.CONFLICT,
        message: 'The resource already exists',
      };
    }

    // Name and stack only: the error message of a failed query can contain
    // the values it was run with.
    const error = exception instanceof Error ? exception : undefined;
    this.logger.error(
      `Unhandled error, name=${error?.name ?? typeof exception}`,
      error?.stack,
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: INTERNAL_ERROR_MESSAGE,
    };
  }

  private fromHttpException(exception: HttpException): ErrorResponseBody {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const fields =
      typeof response === 'object'
        ? (response as { code?: unknown; message?: unknown })
        : {};

    const code = isErrorCode(fields.code)
      ? fields.code
      : defaultErrorCode(statusCode);

    if (statusCode >= 500) {
      return {
        statusCode,
        code,
        message: NEUTRAL_MESSAGES[code] ?? INTERNAL_ERROR_MESSAGE,
      };
    }

    // `ValidationPipe` puts a string[] in `message`; a plain
    // `new NotFoundException('Role not found')` puts a string.
    const message =
      typeof response === 'string'
        ? response
        : isMessage(fields.message)
          ? fields.message
          : exception.message;

    return { statusCode, code, message };
  }
}

function isMessage(value: unknown): value is string | string[] {
  return (
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}
