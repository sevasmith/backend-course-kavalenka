import { ConsoleLogger, LogLevel } from '@nestjs/common';

import { currentRequestId } from './request-context';

/**
 * Adds `, requestId=<id>` to a log line written during a request, so every
 * `this.logger.log(...)` in the app gets it without changing the call.
 *
 * Only string messages (all of ours are `key=value` strings). A line that
 * already names its request (`CsrfGuard`, the RBAC audit) is left as is.
 */
export function withRequestId(message: unknown): unknown {
  const requestId = currentRequestId();
  if (
    requestId === undefined ||
    typeof message !== 'string' ||
    message.includes('requestId=')
  ) {
    return message;
  }
  return `${message}, requestId=${requestId}`;
}

/**
 * Nest's default console logger plus the request id. Set in `main.ts` with
 * `bufferLogs` + `useLogger`, so it also replaces the logger every
 * `new Logger(Context)` in the app writes through.
 */
export class RequestIdLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
  ): void {
    super.printMessages(
      messages.map(withRequestId),
      context,
      logLevel,
      writeStreamType,
      errorStack,
    );
  }
}
