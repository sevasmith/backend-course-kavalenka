import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash?: string;

  /**
   * Made once at startup with the same parameters as real hashes, so checking
   * against it costs as much as a real check. The password is random and
   * never kept, so nothing can match it. Nest awaits this before the app
   * accepts requests.
   */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('base64url'));
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  /**
   * For a login with an unknown email: does the same work as `verify`, so the
   * response time does not reveal that the account is missing. Always false.
   */
  async verifyDummy(password: string): Promise<false> {
    if (!this.dummyHash) {
      throw new Error('PasswordService is not initialized');
    }
    await argon2.verify(this.dummyHash, password);
    return false;
  }
}
