import { UserStatus } from '@/modules/users/user.types';
import { RegistrationChallengeMethod } from './registration-challenge.types';
import { LoginChallengeMethod } from './login-challenge.types';

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

/**
 * The 202 body of a login that needs the email step. No cookies yet, and the
 * secret is never part of it: it goes only into the email.
 */
export interface LoginConfirmationRequired {
  confirmationRequired: true;
  method: LoginChallengeMethod;
  attemptId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

/** Direct login gives the token pair; the email step gives the 202 body. */
export type LoginResult = AuthTokens | LoginConfirmationRequired;

/**
 * Why a login confirmation failed. Only for the log: the client gets the
 * shared 400, the 401 of login (`user_inactive`) or a 429
 * (`attempts_exhausted`).
 */
export type LoginConfirmationFailureReason =
  | 'not_found'
  | 'wrong_method'
  | 'consumed'
  | 'expired'
  | 'attempts_exhausted'
  | 'user_inactive'
  | 'wrong_secret';

/**
 * What the confirmation transaction decided. It is returned, not thrown:
 * a throw inside the transaction would roll back the wrong-code counter and
 * the `user_inactive` consumption.
 */
export type LoginConfirmationOutcome =
  | { confirmed: true; attemptId: string; userId: string; tokens: AuthTokens }
  | {
      confirmed: false;
      reason: LoginConfirmationFailureReason;
      attemptId?: string;
      userId?: string;
      attempts?: number;
    };
