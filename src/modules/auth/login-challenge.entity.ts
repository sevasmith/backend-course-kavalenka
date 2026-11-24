import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../users/user.entity';
import {
  LoginChallengeConsumedReason,
  LoginChallengeMethod,
} from './login-challenge.types';

/**
 * One email confirmation attempt for the second login step.
 *
 * The partial unique index lets a user have at most one unconsumed attempt.
 * A new attempt can be created only after the previous one is consumed
 * (for example as `replaced`), so two parallel logins cannot both leave an
 * active attempt behind. It also serves the lookup "active attempt of this user".
 *
 * There is no `expires_at`: the attempt expires at `last_sent_at + 10 min`.
 * Storing it would duplicate `last_sent_at` and break BCNF.
 */
@Index('IDX_login_challenges_user_id_unconsumed', ['userId'], {
  unique: true,
  where: `"consumed_at" IS NULL`,
})
@Entity('login_challenges')
export class LoginChallenge {
  /**
   * Returned to the client as `attemptId` and used as the first part of the
   * magic link token `attemptId.secret`.
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: Object.values(LoginChallengeMethod),
    enumName: 'login_challenge_method',
  })
  method: LoginChallengeMethod;

  /**
   * HMAC-SHA256 of the OTP code or magic link secret with
   * `LOGIN_CHALLENGE_HMAC_KEY`. The secret itself is never stored.
   */
  @Column({ name: 'secret_hash', type: 'text' })
  secretHash: string;

  /**
   * When the current secret was generated. The 10-minute TTL and the
   * 60-second resend pause are counted from it.
   */
  @Column({ name: 'last_sent_at', type: 'timestamptz' })
  lastSentAt: Date;

  /**
   * Number of wrong OTP entries. The attempt is consumed after the fifth one.
   */
  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  /**
   * Set together with `consumedAt`. Null while the attempt is active.
   */
  @Column({
    name: 'consumed_reason',
    type: 'enum',
    enum: Object.values(LoginChallengeConsumedReason),
    enumName: 'login_challenge_consumed_reason',
    nullable: true,
  })
  consumedReason: LoginChallengeConsumedReason | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
