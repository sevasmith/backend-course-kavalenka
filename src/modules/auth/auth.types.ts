import { UserStatus } from '@/modules/users/user.types';

export interface RegisterResult {
  id: string;
  email: string;
  status: UserStatus;
}
