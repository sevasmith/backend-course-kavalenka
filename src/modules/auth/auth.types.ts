import { UserStatus } from '@/modules/users/user.types';
import { RegistrationChallengeMethod } from './registration-challenge.types';

export interface RegisterResult {
  id: string;
  email: string;
  status: UserStatus;
}

export interface RegisterPendingResult {
  confirmationRequired: true;
  method: RegistrationChallengeMethod;
  attemptId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

/**
 * 200 body of a successful confirmation: the same safe profile as the 201.
 */
export type ConfirmRegistrationResult = RegisterResult;

/**
 * Why a confirmation failed. Only for the log: the client gets the shared 400
 * or, for `attempts_exhausted`, a 429.
 */
export type ConfirmationFailureReason =
  | 'not_found'
  | 'consumed'
  | 'expired'
  | 'attempts_exhausted'
  | 'wrong_secret'
  | 'user_not_pending';

/**
 * What the confirmation transaction decided. It is returned, not thrown:
 * a throw inside the transaction would roll back the wrong-code counter.
 */
export type ConfirmationOutcome =
  | { confirmed: true; attemptId: string; user: ConfirmRegistrationResult }
  | {
      confirmed: false;
      reason: ConfirmationFailureReason;
      attemptId?: string;
      userId?: string;
      attempts?: number;
    };
