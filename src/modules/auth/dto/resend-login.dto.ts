import { IsUUID } from 'class-validator';

/**
 * Body of `POST /auth/login/resend`. Only the attempt id: the method and the
 * email come from the saved attempt and its user, never from the client.
 */
export class ResendLoginDto {
  @IsUUID(undefined, { message: 'attemptId must be a UUID' })
  attemptId: string;
}
