import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@/core/config/config.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ALGORITHM,
  JWT_CLOCK_SKEW_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  TokenClaims,
  TokenFailure,
  TokenUse,
  TokenVerification,
} from './token.types';

/**
 * Signs and verifies the access and refresh JWTs.
 *
 * Each type has its own key and its own `token_use`, so a leaked key or a
 * token in the wrong cookie can't be used as the other type. Verification
 * never throws: it returns the user id or the failure category for logs.
 */
@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(configService: ConfigService) {
    this.accessSecret = configService.get('JWT_ACCESS_SECRET');
    this.refreshSecret = configService.get('JWT_REFRESH_SECRET');
    this.issuer = configService.get('JWT_ISSUER');
    this.audience = configService.get('JWT_AUDIENCE');
  }

  /** Throws if signing fails; login and refresh turn that into `503`. */
  signAccess(userId: string): string {
    return this.sign(userId, TokenUse.ACCESS);
  }

  /** Throws if signing fails; login and refresh turn that into `503`. */
  signRefresh(userId: string): string {
    return this.sign(userId, TokenUse.REFRESH);
  }

  verifyAccess(token: string | undefined): TokenVerification {
    return this.verify(token, TokenUse.ACCESS);
  }

  verifyRefresh(token: string | undefined): TokenVerification {
    return this.verify(token, TokenUse.REFRESH);
  }

  private sign(userId: string, tokenUse: TokenUse): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: TokenClaims = {
      sub: userId,
      iss: this.issuer,
      aud: this.audience,
      iat: now,
      exp: now + this.ttl(tokenUse),
      token_use: tokenUse,
    };

    return jwt.sign(claims, this.secret(tokenUse), {
      algorithm: JWT_ALGORITHM,
    });
  }

  private verify(
    token: string | undefined,
    expectedUse: TokenUse,
  ): TokenVerification {
    if (!token) {
      return this.fail(TokenFailure.MISSING);
    }

    // `decode` only parses, it checks nothing. It separates "not a JWT at
    // all" from "a JWT with a bad signature".
    const decoded = jwt.decode(token);
    if (decoded === null || typeof decoded !== 'object') {
      return this.fail(TokenFailure.MALFORMED);
    }

    let payload: jwt.JwtPayload;
    try {
      // The algorithm is pinned: a token with `alg: none` or RS256 fails here.
      // `verify` checks the signature first, then `exp` and `nbf`.
      const verified = jwt.verify(token, this.secret(expectedUse), {
        algorithms: [JWT_ALGORITHM],
        clockTolerance: JWT_CLOCK_SKEW_SECONDS,
      });
      if (typeof verified !== 'object') {
        return this.fail(TokenFailure.MALFORMED);
      }
      payload = verified;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return this.fail(TokenFailure.EXPIRED);
      }
      if (error instanceof jwt.NotBeforeError) {
        return this.fail(TokenFailure.CLAIMS);
      }
      return this.fail(TokenFailure.SIGNATURE);
    }

    // The claims are checked here and not with `verify` options, so a wrong
    // claim has its own category instead of a parsed error message.
    if (!this.hasValidClaims(payload)) {
      return this.fail(TokenFailure.CLAIMS);
    }

    if (payload.token_use !== expectedUse) {
      return this.fail(TokenFailure.TOKEN_USE);
    }

    return { ok: true, userId: payload.sub as string };
  }

  private hasValidClaims(payload: jwt.JwtPayload): boolean {
    const now = Math.floor(Date.now() / 1000);

    return (
      typeof payload.sub === 'string' &&
      payload.sub.length > 0 &&
      payload.iss === this.issuer &&
      // Only a single string, exactly as we issue it, not an array.
      payload.aud === this.audience &&
      typeof payload.iat === 'number' &&
      payload.iat <= now + JWT_CLOCK_SKEW_SECONDS &&
      // `verify` checks `exp` only when it's present, so require it here.
      typeof payload.exp === 'number' &&
      payload.exp > payload.iat
    );
  }

  private secret(tokenUse: TokenUse): string {
    return tokenUse === TokenUse.ACCESS
      ? this.accessSecret
      : this.refreshSecret;
  }

  private ttl(tokenUse: TokenUse): number {
    return tokenUse === TokenUse.ACCESS
      ? ACCESS_TOKEN_TTL_SECONDS
      : REFRESH_TOKEN_TTL_SECONDS;
  }

  private fail(reason: TokenFailure): TokenVerification {
    return { ok: false, reason };
  }
}
