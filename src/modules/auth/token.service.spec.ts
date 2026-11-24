import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@/core/config/config.service';
import { TokenService } from './token.service';
import { TokenFailure } from './token.types';

describe('TokenService', () => {
  const config: Record<string, string> = {
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'r'.repeat(32),
    JWT_ISSUER: 'course-api',
    JWT_AUDIENCE: 'course-web',
  };
  const userId = 'user-42';

  let service: TokenService;

  const now = () => Math.floor(Date.now() / 1000);

  /** A token with our access key and the given claims, for broken cases. */
  const craftAccess = (
    claims: Record<string, unknown>,
    options: jwt.SignOptions = {},
  ) => {
    // `jwt.sign` rejects `undefined` claims, so drop them to leave a claim out.
    const defined = Object.fromEntries(
      Object.entries(claims).filter(([, value]) => value !== undefined),
    );

    return jwt.sign(defined, config.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      ...options,
    });
  };

  const validClaims = () => ({
    sub: userId,
    iss: config.JWT_ISSUER,
    aud: config.JWT_AUDIENCE,
    iat: now(),
    exp: now() + 900,
    token_use: 'access',
  });

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    service = module.get(TokenService);
  });

  describe('signing', () => {
    it('puts all claims into the access token with a 15-minute TTL', () => {
      const claims = jwt.decode(service.signAccess(userId)) as jwt.JwtPayload;

      expect(claims).toMatchObject({
        sub: userId,
        iss: 'course-api',
        aud: 'course-web',
        token_use: 'access',
      });
      expect(claims.exp! - claims.iat!).toBe(900);
    });

    it('gives the refresh token a 30-day TTL', () => {
      const claims = jwt.decode(service.signRefresh(userId)) as jwt.JwtPayload;

      expect(claims.token_use).toBe('refresh');
      expect(claims.exp! - claims.iat!).toBe(2592000);
    });

    it('uses HS256', () => {
      const { header } = jwt.decode(service.signAccess(userId), {
        complete: true,
      })!;

      expect(header.alg).toBe('HS256');
    });

    it('signs access and refresh with different keys', () => {
      const access = service.signAccess(userId);
      const refresh = service.signRefresh(userId);

      expect(() => jwt.verify(access, config.JWT_ACCESS_SECRET)).not.toThrow();
      expect(() => jwt.verify(refresh, config.JWT_ACCESS_SECRET)).toThrow();
    });
  });

  describe('verification', () => {
    it('accepts its own access and refresh tokens', () => {
      expect(service.verifyAccess(service.signAccess(userId))).toEqual({
        ok: true,
        userId,
      });
      expect(service.verifyRefresh(service.signRefresh(userId))).toEqual({
        ok: true,
        userId,
      });
    });

    it.each([undefined, ''])('returns missing for %p', (token) => {
      expect(service.verifyAccess(token)).toEqual({
        ok: false,
        reason: TokenFailure.MISSING,
      });
    });

    it.each(['not-a-jwt', 'a.b.c', 'eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.sig'])(
      'returns malformed for %p',
      (token) => {
        expect(service.verifyAccess(token)).toEqual({
          ok: false,
          reason: TokenFailure.MALFORMED,
        });
      },
    );

    it('returns signature for a changed signature', () => {
      const token = service.signAccess(userId);
      const last = token.at(-1) === 'A' ? 'B' : 'A';

      expect(service.verifyAccess(token.slice(0, -1) + last)).toEqual({
        ok: false,
        reason: TokenFailure.SIGNATURE,
      });
    });

    it('returns signature for a token signed with another key', () => {
      const token = jwt.sign(validClaims(), 'x'.repeat(32), {
        algorithm: 'HS256',
      });

      expect(service.verifyAccess(token)).toEqual({
        ok: false,
        reason: TokenFailure.SIGNATURE,
      });
    });

    it('rejects alg none', () => {
      const token = craftAccess(validClaims(), { algorithm: 'none' });

      expect(service.verifyAccess(token)).toEqual({
        ok: false,
        reason: TokenFailure.SIGNATURE,
      });
    });

    it('rejects a refresh token as an access token', () => {
      expect(service.verifyAccess(service.signRefresh(userId))).toEqual({
        ok: false,
        reason: TokenFailure.SIGNATURE,
      });
    });

    it('returns token_use for the wrong type signed with the right key', () => {
      const token = craftAccess({ ...validClaims(), token_use: 'refresh' });

      expect(service.verifyAccess(token)).toEqual({
        ok: false,
        reason: TokenFailure.TOKEN_USE,
      });
    });

    describe('expiry and clock skew', () => {
      it('accepts a token that expired less than 30 seconds ago', () => {
        const token = craftAccess({
          ...validClaims(),
          iat: now() - 900,
          exp: now() - 20,
        });

        expect(service.verifyAccess(token).ok).toBe(true);
      });

      it('returns expired after the 30-second skew', () => {
        const token = craftAccess({
          ...validClaims(),
          iat: now() - 900,
          exp: now() - 40,
        });

        expect(service.verifyAccess(token)).toEqual({
          ok: false,
          reason: TokenFailure.EXPIRED,
        });
      });
    });

    it.each<[string, Record<string, unknown>]>([
      ['no sub', { sub: undefined }],
      ['empty sub', { sub: '' }],
      ['wrong iss', { iss: 'other-api' }],
      ['wrong aud', { aud: 'other-web' }],
      ['aud as an array', { aud: ['course-web'] }],
      ['iat in the future', { iat: now() + 120, exp: now() + 1000 }],
      ['no exp', { exp: undefined }],
    ])('returns claims for %s', (_case, override) => {
      const token = craftAccess({ ...validClaims(), ...override });

      expect(service.verifyAccess(token)).toEqual({
        ok: false,
        reason: TokenFailure.CLAIMS,
      });
    });

    it('returns claims for no iat', () => {
      // Without `noTimestamp`, `jwt.sign` would add `iat` by itself.
      const token = craftAccess(
        { ...validClaims(), iat: undefined },
        { noTimestamp: true },
      );

      expect(service.verifyAccess(token)).toEqual({
        ok: false,
        reason: TokenFailure.CLAIMS,
      });
    });
  });
});
