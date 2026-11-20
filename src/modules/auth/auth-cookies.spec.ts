import fastifyCookie from '@fastify/cookie';
import Fastify, { FastifyInstance } from 'fastify';
import { clearAuthCookies, setAuthCookies } from './auth-cookies';

/**
 * A real Fastify app with the cookie plugin, so the tests check the exact
 * `Set-Cookie` headers a browser would get, not calls on a mock.
 */
describe('auth cookies', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyCookie);
    app.post('/set', (_request, reply) => {
      setAuthCookies(reply, 'access-jwt', 'refresh-jwt');
      return reply.status(204).send();
    });
    app.post('/clear', (_request, reply) => {
      clearAuthCookies(reply);
      return reply.status(204).send();
    });
    await app.ready();
  });

  afterAll(() => app.close());

  const setCookies = async (url: string): Promise<string[]> => {
    const response = await app.inject({ method: 'POST', url });
    const header = response.headers['set-cookie'];

    return Array.isArray(header) ? header : [header ?? ''];
  };

  /** The attributes after `name=value`, sorted so the order doesn't matter. */
  const attributes = (cookie: string): string[] =>
    cookie.split('; ').slice(1).sort();

  describe('setAuthCookies', () => {
    let access: string;
    let refresh: string;

    beforeAll(async () => {
      [access, refresh] = await setCookies('/set');
    });

    it('sets the access cookie for every path for 15 minutes', () => {
      expect(access.startsWith('access_token=access-jwt;')).toBe(true);
      expect(attributes(access)).toEqual(
        [
          'HttpOnly',
          'Max-Age=900',
          'Path=/',
          'SameSite=Strict',
          'Secure',
        ].sort(),
      );
    });

    it('sets the refresh cookie only for /auth/refresh for 30 days', () => {
      expect(refresh.startsWith('refresh_token=refresh-jwt;')).toBe(true);
      expect(attributes(refresh)).toEqual(
        [
          'HttpOnly',
          'Max-Age=2592000',
          'Path=/auth/refresh',
          'SameSite=Strict',
          'Secure',
        ].sort(),
      );
    });

    it('sets no Domain, so both cookies are host-only', () => {
      expect(access.toLowerCase()).not.toContain('domain=');
      expect(refresh.toLowerCase()).not.toContain('domain=');
    });
  });

  describe('clearAuthCookies', () => {
    let access: string;
    let refresh: string;

    beforeAll(async () => {
      [access, refresh] = await setCookies('/clear');
    });

    it('empties both cookies and expires them in the past', () => {
      for (const cookie of [access, refresh]) {
        expect(cookie).toMatch(/^(access|refresh)_token=;/);
        expect(cookie).toContain('Max-Age=0');
        expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      }
    });

    it('keeps the original Path and security attributes', () => {
      expect(access).toContain('Path=/;');
      expect(refresh).toContain('Path=/auth/refresh;');
      for (const cookie of [access, refresh]) {
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie.toLowerCase()).not.toContain('domain=');
      }
    });
  });
});
