import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { integerSetting } from '../security/config.js';
import { SUPABASE_CA } from './supabase-ca.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor() {
    const ca =
      process.env.PG_SSL_CA?.replace(/\\n/g, '\n') ||
      (process.env.PG_SSL_CA_FILE
        ? readFileSync(process.env.PG_SSL_CA_FILE, 'utf8')
        : /\.supabase\.(?:com|co)$/.test(process.env.PG_HOST || '')
          ? SUPABASE_CA
          : undefined);
    this.pool = new Pool({
      user: process.env.PG_USER,
      host: process.env.PG_HOST,
      database: process.env.PG_DATABASE,
      password: process.env.PG_PASSWORD,
      port: Number(process.env.PG_PORT || 5432),
      ssl:
        process.env.PG_SSL === 'false' && process.env.NODE_ENV !== 'production'
          ? false
          : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      max: integerSetting('PG_POOL_MAX', 10, 1, 100),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      query_timeout: 20_000,
      idle_in_transaction_session_timeout: 15_000,
    });
    this.pool.on('connect', () => this.logger.log('Database pool connected successfully'));
    this.pool.on('error', (error) =>
      this.logger.error('Unexpected error on idle database client', error.stack),
    );
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    this.checkCapacity();
    return this.pool.query<T>(text, params);
  }

  /** A transaction must keep every query on the same pooled connection. */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    this.checkCapacity();
    const client = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError = rollbackError;
        this.logger.error('Transaction rollback failed', rollbackError);
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  private checkCapacity() {
    if (this.pool.waitingCount >= 100) throw new ServiceUnavailableException('Database busy');
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
