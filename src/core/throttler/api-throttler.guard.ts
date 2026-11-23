import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

import { apiError, ErrorCode } from '@/core/http/api-error';

export const RATE_LIMIT_MESSAGE = 'Too many requests, try again later';

/**
 * The library guard, with our 429 body. By default it throws
 * `ThrottlerException` with the text "ThrottlerException: Too Many Requests",
 * which names the library and differs from every other 429 of the API.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    return Promise.reject(
      new HttpException(
        apiError(ErrorCode.RATE_LIMIT_EXCEEDED, RATE_LIMIT_MESSAGE, {
          // Seconds; at least 1, so a client never retries at once.
          retryAfterSeconds: Math.max(1, Math.ceil(detail.timeToBlockExpire)),
        }),
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  }
}
