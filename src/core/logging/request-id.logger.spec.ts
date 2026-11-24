import { CLS_ID, ClsServiceManager } from 'nestjs-cls';

import { currentRequestId } from './request-context';
import { RequestIdLogger, withRequestId } from './request-id.logger';

describe('request id in logs', () => {
  const cls = ClsServiceManager.getClsService();

  /** Runs `fn` as if inside a request with this id. */
  const inRequest = <T>(id: string, fn: () => T): T =>
    cls.run(() => {
      cls.set(CLS_ID, id);
      return fn();
    });

  it('has no id outside a request (e.g. startup lines)', () => {
    expect(currentRequestId()).toBeUndefined();
    expect(withRequestId('Nest application started')).toBe(
      'Nest application started',
    );
  });

  it('appends the id of the current request', () => {
    expect(inRequest('req-1', () => withRequestId('Logout, userId=u1'))).toBe(
      'Logout, userId=u1, requestId=req-1',
    );
  });

  it('keeps each request separate, even across awaits', async () => {
    const lineAfterAwait = (id: string) =>
      inRequest(id, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return withRequestId('line');
      });

    await expect(
      Promise.all([lineAfterAwait('a'), lineAfterAwait('b')]),
    ).resolves.toEqual(['line, requestId=a', 'line, requestId=b']);
  });

  it('leaves a line that already names its request', () => {
    expect(
      inRequest('req-1', () => withRequestId('CSRF rejected, requestId=req-1')),
    ).toBe('CSRF rejected, requestId=req-1');
  });

  it('leaves non-string messages alone', () => {
    const message = { event: 'x' };
    expect(inRequest('req-1', () => withRequestId(message))).toBe(message);
  });

  it('writes the id through the logger', () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const logger = new RequestIdLogger('Test', { colors: false });

    inRequest('req-9', () => logger.log('Login succeeded, userId=u1'));

    expect(String(write.mock.calls[0][0])).toContain(
      'Login succeeded, userId=u1, requestId=req-9',
    );
    write.mockRestore();
  });
});
