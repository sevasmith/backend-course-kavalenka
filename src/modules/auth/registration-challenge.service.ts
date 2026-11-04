import { createHmac, randomBytes, randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { RegistrationChallenge } from './registration-challenge.entity';
import {
  CreatedRegistrationChallenge,
  REGISTRATION_CHALLENGE_TTL_SECONDS,
  RegistrationChallengeMethod,
} from './registration-challenge.types';

const OTP_MAX = 1_000_000;
const OTP_LENGTH = 6;
const MAGIC_LINK_TOKEN_BYTES = 32;

@Injectable()
export class RegistrationChallengeService {
  constructor(
    @InjectRepository(RegistrationChallenge)
    private readonly challengesRepository: Repository<RegistrationChallenge>,
    private readonly configService: ConfigService,
  ) {}

  async create(
    userId: string,
    method: RegistrationChallengeMethod,
  ): Promise<CreatedRegistrationChallenge> {
    const secret = generateSecret(method);
    const now = new Date();

    const challenge = await this.challengesRepository.save(
      this.challengesRepository.create({
        userId,
        method,
        secretHash: this.hmac(secret),
        expiresAt: new Date(
          now.getTime() + REGISTRATION_CHALLENGE_TTL_SECONDS * 1000,
        ),
        lastSentAt: now,
      }),
    );

    return { challenge, secret };
  }

  /**
   * OTP: found by id only. Comparing the code happens later, against this one
   * attempt: a 6-digit HMAC must never be searched across the whole table.
   */
  findOtpAttempt(attemptId: string): Promise<RegistrationChallenge | null> {
    return this.challengesRepository.findOneBy({
      id: attemptId,
      method: RegistrationChallengeMethod.OTP,
    });
  }

  /**
   * Magic link: found by the HMAC of the token (partial unique index). The
   * method filter stops an OTP code sent as a token from matching an OTP row.
   */
  findMagicLinkAttempt(token: string): Promise<RegistrationChallenge | null> {
    return this.challengesRepository.findOneBy({
      secretHash: this.hmac(token),
      method: RegistrationChallengeMethod.MAGIC_LINK,
    });
  }

  private hmac(secret: string): string {
    return createHmac(
      'sha256',
      this.configService.get('REGISTRATION_CHALLENGE_HMAC_KEY'),
    )
      .update(secret)
      .digest('hex');
  }
}

function generateSecret(method: RegistrationChallengeMethod): string {
  if (method === RegistrationChallengeMethod.OTP) {
    return randomInt(0, OTP_MAX).toString().padStart(OTP_LENGTH, '0');
  }
  return randomBytes(MAGIC_LINK_TOKEN_BYTES).toString('base64url');
}
