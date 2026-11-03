import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '@/modules/users/user.entity';
import { RegistrationChallengeMethod } from './registration-challenge.types';

@Entity('registration_challenges')
export class RegistrationChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: Object.values(RegistrationChallengeMethod),
    enumName: 'registration_challenge_method',
  })
  method: RegistrationChallengeMethod;

  /**
   * HMAC-SHA256 of the OTP code or magic link token. The secret itself is never stored.
   */
  @Column({ name: 'secret_hash', type: 'text' })
  secretHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /**
   * Number of incorrect code entries. The attempt is consumed after the fifth one.
   */
  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'last_sent_at', type: 'timestamptz' })
  lastSentAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;
}
