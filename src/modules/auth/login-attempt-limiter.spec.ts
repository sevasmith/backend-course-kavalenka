import { HttpException, HttpStatus } from '@nestjs/common';

import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_FAILURES_EXCEEDED_MESSAGE,
  LoginAttemptLimiter,
} from './login-attempt-limiter';

describe('LoginAttemptLimiter', () => {
  const email = 'user@example.com';
  const ip = '203.0.113.7';

  let limiter: LoginAttemptLimiter;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-21T10:00:00Z') });
    limiter = new LoginAttemptLimiter();
  });

  afterEach(() => {
    limiter.onModuleDestroy();
    jest.useRealTimers();
  });

  /** Reserves `count` slots and leaves them counted as failures. */
  const fail = (count: number, forEmail = email, forIp = ip) => {
    for (let i = 0; i < count; i++) limiter.reserve(forEmail, forIp);
  };

  const expect429 = (forEmail = email, forIp = ip) => {
    let error: unknown;
    try {
      limiter.reserve(forEmail, forIp);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    return (error as HttpException).getResponse();
  };

  it('allows 5 failures, then refuses the 6th attempt', () => {
    fail(LOGIN_FAILURE_LIMIT);

    expect429();
  });

  it('counts each email and IP pair on its own', () => {
    fail(LOGIN_FAILURE_LIMIT);

    expect(() => limiter.reserve('other@example.com', ip)).not.toThrow();
    expect(() => limiter.reserve(email, '198.51.100.1')).not.toThrow();
  });

  it('forgets failures older than 15 minutes', () => {
    fail(LOGIN_FAILURE_LIMIT);

    jest.advanceTimersByTime(LOGIN_FAILURE_WINDOW_MS + 1);

    expect(() => limiter.reserve(email, ip)).not.toThrow();
  });

  it('uses a sliding window, not a fixed one', () => {
    fail(1);
    jest.advanceTimersByTime(10 * 60 * 1000);
    fail(LOGIN_FAILURE_LIMIT - 1);

    // 14 minutes after the first failure: all 5 still count.
    jest.advanceTimersByTime(4 * 60 * 1000);
    expect429();

    // The first failure has left the window: one more attempt is allowed.
    jest.advanceTimersByTime(60 * 1000 + 1);
    expect(() => limiter.reserve(email, ip)).not.toThrow();
    expect429();
  });

  it('clears the pair after a successful login', () => {
    fail(LOGIN_FAILURE_LIMIT - 1);
    const slot = limiter.reserve(email, ip);

    limiter.reset(slot);

    fail(LOGIN_FAILURE_LIMIT);
    expect429();
  });

  it('gives back only the released slot', () => {
    fail(LOGIN_FAILURE_LIMIT - 1);
    const slot = limiter.reserve(email, ip);

    limiter.release(slot);

    expect(() => limiter.reserve(email, ip)).not.toThrow();
    expect429();
  });

  it('does not count a refused attempt as a failure', () => {
    fail(LOGIN_FAILURE_LIMIT);
    expect429();
    expect429();

    // Still only 5 failures: once they expire, the pair is free again.
    jest.advanceTimersByTime(LOGIN_FAILURE_WINDOW_MS + 1);
    fail(LOGIN_FAILURE_LIMIT);
    expect429();
  });

  it('names the code and when the oldest failure leaves the window', () => {
    fail(LOGIN_FAILURE_LIMIT);
    jest.advanceTimersByTime(60_000);

    expect(expect429()).toEqual({
      code: 'rate_limit_exceeded',
      message: LOGIN_FAILURES_EXCEEDED_MESSAGE,
      details: { retryAfterSeconds: LOGIN_FAILURE_WINDOW_MS / 1000 - 60 },
    });
  });
});
