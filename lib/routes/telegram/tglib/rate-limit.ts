import { createHash } from 'node:crypto';

import { RateLimiterMemory, RateLimiterQueue, RateLimiterRedis } from 'rate-limiter-flexible';

import { config } from '@/config';
import cache from '@/utils/cache';
import logger from '@/utils/logger';

let warnedMemoryBackend = false;

const interval = Number(config.telegram.requestInterval || 0);
const queueSize = Number(config.telegram.rateLimitQueueSize || 1000);
const useRedis = interval > 0 && cache.clients.redisClient && ['auto', 'redis'].includes(config.telegram.rateLimitBackend || 'auto');

const limiter =
    interval > 0
        ? useRedis
            ? new RateLimiterRedis({
                  points: 1,
                  duration: interval,
                  execEvenly: true,
                  storeClient: cache.clients.redisClient,
                  keyPrefix: 'rsshub:telegram',
              })
            : new RateLimiterMemory({
                  points: 1,
                  duration: interval,
                  execEvenly: true,
              })
        : null;

const limiterQueue = limiter
    ? new RateLimiterQueue(limiter, {
          maxQueueSize: queueSize,
      })
    : null;

export function getTelegramRateLimitKey(session?: string) {
    const identity = [config.telegram.apiId ?? 4, config.telegram.apiHash ?? '014b35b6184100b085b0d0572f9b5103', session ?? config.telegram.session ?? config.telegram.token ?? 'default'].join(':');
    return createHash('sha256').update(identity).digest('hex');
}

export async function withTelegramRateLimit<T>(fn: () => T | Promise<T>, session?: string): Promise<T> {
    if (!limiterQueue || interval <= 0) {
        return fn();
    }
    if (!useRedis && config.telegram.rateLimitBackend === 'redis') {
        logger.warn('TELEGRAM_RATE_LIMIT_BACKEND=redis was requested but Redis cache is not available; falling back to process-local memory limiting.');
    } else if (!useRedis && !warnedMemoryBackend) {
        warnedMemoryBackend = true;
        logger.warn('Telegram rate limiting is process-local because Redis cache is not available.');
    }
    await limiterQueue.removeTokens(1, getTelegramRateLimitKey(session));
    return fn();
}
