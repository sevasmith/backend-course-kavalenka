import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';

/**
 * Identifiers for the logs that must never contain the value itself.
 *
 * 1.2: "For an unknown email, an irreversible internal identifier with a
 * separate key is used, so that attacks can be correlated without recording
 * the address."
 */
@Injectable()
export class AuditIdService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * The same email always gives the same id, so many attempts on one
   * address can be grouped in the logs. A keyed HMAC, not a plain SHA-256:
   * without the key, nobody can hash a list of known emails and look for a
   * match. 16 hex characters (64 bits) are plenty to tell addresses apart.
   *
   * Expects the normalized email (`LoginDto` trims and lowercases it).
   */
  forEmail(email: string): string {
    return createHmac('sha256', this.configService.get('AUDIT_LOG_HMAC_KEY'))
      .update(email)
      .digest('hex')
      .slice(0, 16);
  }
}
