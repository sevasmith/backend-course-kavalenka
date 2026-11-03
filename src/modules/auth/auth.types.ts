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
