import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      user: process.env.PG_USER,
      host: process.env.PG_HOST,
      database: process.env.PG_DATABASE,
      password: process.env.PG_PASSWORD,
      port: Number(process.env.PG_PORT || 5432),
      // Preserve the existing hosted PostgreSQL connection settings.
      ssl: { rejectUnauthorized: false },
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
    return this.pool.query<T>(text, params);
  }

  /** A transaction must keep every query on the same pooled connection. */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
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

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
