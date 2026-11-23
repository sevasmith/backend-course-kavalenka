import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerLimitDetail } from '@nestjs/throttler';

import { ApiThrottlerGuard, RATE_LIMIT_MESSAGE } from './api-throttler.guard';

/** Opens the protected method for the test without changing its visibility. */
class TestableGuard extends ApiThrottlerGuard {
  throwFor(detail: Partial<ThrottlerLimitDetail>): Promise<void> {
    return this.throwThrottlingException(
      {} as ExecutionContext,
      detail as ThrottlerLimitDetail,
    );
  }
}

describe('ApiThrottlerGuard', () => {
  // The constructor arguments are not used by the method under test.
  const guard = new TestableGuard({ throttlers: [] }, {} as never, {} as never);

  const rejectWith = async (timeToBlockExpire: number) => {
    const error: unknown = await guard
      .throwFor({ timeToBlockExpire })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    return (error as HttpException).getResponse();
  };

  it('rejects with rate_limit_exceeded, a neutral text and the wait', async () => {
    expect(await rejectWith(42)).toEqual({
      code: 'rate_limit_exceeded',
      message: RATE_LIMIT_MESSAGE,
      details: { retryAfterSeconds: 42 },
    });
  });

  it('never tells the client to retry in 0 seconds', async () => {
    expect(await rejectWith(0)).toMatchObject({
      details: { retryAfterSeconds: 1 },
    });
  });
});
