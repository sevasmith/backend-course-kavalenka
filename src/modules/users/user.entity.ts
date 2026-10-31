import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

import { UserStatus } from './user.types';

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'text', unique: true })
    email: string;

    @Column({ name: 'password_hash', type: 'text' })
    passwordHash: string;

    @Column({
        type: 'enum',
        enum: UserStatus,
        enumName: 'user_status',
        default: UserStatus.PENDING,
    })
    status: UserStatus;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
