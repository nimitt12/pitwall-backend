import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, RequestHandler } from 'express';
import { MemoryStore, rateLimit, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { integerSetting } from './config.js';

@Injectable()
export class RateLimitService implements OnApplicationShutdown {
  private client?: ReturnType<typeof createClient>;
  private stores: Store[] = [];

  async configure(): Promise<RequestHandler[]> {
    if (process.env.REDIS_URL) {
      let hasConnected = false;
      this.client = createClient({
        url: process.env.REDIS_URL,
        disableOfflineQueue: true,
        commandsQueueMaxLength: 1000,
        commandOptions: { timeout: 2000 },
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) =>
            !hasConnected && retries > 3 ? false : Math.min(5000, 100 * (retries + 1)),
        },
      });
      this.client.on('ready', () => {
        hasConnected = true;
      });
      this.client.on('error', () =>
        new Logger('RateLimit').error('Redis rate-limit storage unavailable'),
      );
      try {
        await this.client.connect();
      } catch (error) {
        if (this.client.isOpen) this.client.destroy();
        throw error;
      }
    }
    const make = (
      name: string,
      limit: number,
      windowMs: number,
      keyGenerator?: (req: Request) => string,
    ) => {
      const store: Store = this.client
        ? new RedisStore({
            prefix: `pitwall:rate:${name}:`,
            sendCommand: (...args: string[]) => this.client!.sendCommand(args) as Promise<any>,
          })
        : new MemoryStore();
      this.stores.push(store);
      const middleware = rateLimit({
        store,
        windowMs,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        identifier: name,
        keyGenerator,
        passOnStoreError: false,
        message: { message: 'Too many requests. Please retry later.' },
      });

      return ((req, res, next) =>
        middleware(req, res, (error) =>
          next(
            error ? new ServiceUnavailableException('Rate-limit storage unavailable') : undefined,
          ),
        )) as RequestHandler;
    };
    const global = make('public', integerSetting('RATE_LIMIT_PUBLIC', 120), 60_000);
    const auth = make('authentication', integerSetting('RATE_LIMIT_AUTH', 10), 15 * 60_000);
    const expensive = make('expensive', integerSetting('RATE_LIMIT_EXPENSIVE', 10), 60_000);
    // A service-wide budget also bounds distributed attacks on password hashing.
    const authBudget = make(
      'authentication-budget',
      integerSetting('RATE_LIMIT_AUTH_GLOBAL', 100),
      60_000,
      () => 'all',
    );
    return [
      global,
      (req, res, next) => {
        const route = req.path.toLowerCase().replace(/\/+$/, '');
        if (route.startsWith('/auth/'))
          return auth(req, res, (error) => (error ? next(error) : authBudget(req, res, next)));
        if (
          /\/sync-|^\/live\/(replay|simulate|archive)|^\/results\/get-lap-positions|^\/constructors$|^\/account\//.test(
            route,
          )
        ) {
          return expensive(req, res, next);
        }
        next();
      },
    ];
  }

  async onApplicationShutdown() {
    for (const store of this.stores) await store.shutdown?.();
    if (this.client?.isOpen) this.client.destroy();
  }
}
