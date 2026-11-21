import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';

/** task.md: no more than 5 failed logins per (email + IP)… */
export const LOGIN_FAILURE_LIMIT = 5;
/** …within 15 minutes. */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

export const LOGIN_FAILURES_EXCEEDED_MESSAGE =
  'Too many failed login attempts, try again later';

/** One reserved failure: what `reset` and `release` need to find it again. */
export interface LoginAttemptSlot {
  key: string;
  at: number;
}

/**
 * Counts failed password checks per (email + IP) in a sliding 15-minute
 * window, in process memory (see the open question in the 1.2 plan).
 *
 * A slot is reserved *before* the password is checked, and counted as a
 * failure until the caller says otherwise. The check and the reservation
 * run synchronously, so parallel requests can't all slip past the limit
 * while their hash checks are still running.
 *
 * Unknown emails are counted the same way as known ones, so a 429 doesn't
 * reveal whether an account exists. The account itself is never locked: the
 * limit is per email *and* IP, so an attacker can't lock someone else out.
 */
@Injectable()
export class LoginAttemptLimiter implements OnModuleDestroy {
  /** Key → times (ms) of the failures still inside the window. */
  private readonly failures = new Map<string, number[]>();

  // Drops keys nobody came back to, so memory doesn't grow forever.
  // `unref` keeps the timer from holding the process open.
  private readonly sweepTimer = setInterval(
    () => this.sweep(),
    LOGIN_FAILURE_WINDOW_MS,
  ).unref();

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  /**
   * Throws 429 when the pair already has 5 failures in the window, before any
   * hash is computed. Otherwise records one failure and returns its slot.
   */
  reserve(email: string, ip: string): LoginAttemptSlot {
    const key = `${ip} ${email}`;
    const now = Date.now();
    const recent = this.recentFailures(key, now);

    if (recent.length >= LOGIN_FAILURE_LIMIT) {
      throw new HttpException(
        LOGIN_FAILURES_EXCEEDED_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.failures.set(key, recent);
    return { key, at: now };
  }

  /** The password was right: forget the pair's earlier failures too. */
  reset(slot: LoginAttemptSlot): void {
    this.failures.delete(slot.key);
  }

  /**
   * The check didn't finish for a reason that isn't a wrong password (e.g. the
   * database is down): give this one slot back.
   */
  release(slot: LoginAttemptSlot): void {
    const times = this.failures.get(slot.key);
    if (!times) return;

    const index = times.indexOf(slot.at);
    if (index !== -1) times.splice(index, 1);
    if (times.length === 0) this.failures.delete(slot.key);
  }

  private recentFailures(key: string, now: number): number[] {
    const since = now - LOGIN_FAILURE_WINDOW_MS;
    return (this.failures.get(key) ?? []).filter((at) => at > since);
  }

  private sweep(): void {
    const now = Date.now();
    for (const key of this.failures.keys()) {
      const recent = this.recentFailures(key, now);
      if (recent.length === 0) {
        this.failures.delete(key);
      } else {
        this.failures.set(key, recent);
      }
    }
  }
}
