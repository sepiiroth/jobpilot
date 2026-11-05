import { createHmac } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ApiError } from '../common/errors.ts';
const increment =
  "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; return n";
export class RateLimiter {
  private readonly redis: Redis;
  private readonly secret: string;
  constructor(redis: Redis, secret: string) {
    this.redis = redis;
    this.secret = secret;
  }
  async consume(
    scope: string,
    value: string,
    limit: number,
    windowMs: number,
  ): Promise<void> {
    const digest = createHmac('sha256', this.secret)
      .update(value)
      .digest('hex');
    const result = await this.redis.eval(
      increment,
      1,
      'rate:' + scope + ':' + digest,
      windowMs,
    );
    if (Number(result) > limit)
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
  }
}
