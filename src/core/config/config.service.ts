import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

import { Config } from './config.types';

@Injectable()
export class ConfigService extends NestConfigService {
  get<T extends keyof Config>(key: T): Config[T] {
    return super.get<Config[T]>(key) as Config[T];
  }
}
