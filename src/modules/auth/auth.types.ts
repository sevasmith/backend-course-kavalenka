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

/**
 * The one message of every login 401: unknown email, wrong password and any
 * non-active status must look the same.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

/**
 * Who passed the password check. Only the id: it becomes the JWT `sub`.
 */
export interface LoginUser {
  id: string;
}

/** The pair a successful login (or refresh) puts into the two cookies. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
