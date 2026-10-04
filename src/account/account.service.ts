import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class AccountService {
  // See sql/account_deletion_requests.sql. Also created lazily here (like
  // profileService's ensureColumns) so the endpoint works even on a DB the
  // migration file hasn't been run against yet.
  tableEnsured = false;

  ensureTable = async () => {
    if (this.tableEnsured) return;
    await this.db.query(`
    CREATE TABLE IF NOT EXISTS account_deletion_requests (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      email        TEXT NOT NULL,
      reason       TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      requested_at TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now()
    )
  `);
    this.tableEnsured = true;
  };

  constructor(private readonly db: DatabaseService) {}

  async createDeletionRequest(
    userId: string,
    { email, reason }: { email: string; reason?: string },
  ) {
    await this.ensureTable();

    const userResult = await this.db.query('SELECT id, email FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      throw Object.assign(new Error('Account not found'), { status: 404 });
    }
    if (String(user.email).toLowerCase() !== String(email).toLowerCase()) {
      throw Object.assign(new Error('Email does not match the signed-in account'), { status: 400 });
    }

    const existing = await this.db.query(
      `SELECT id FROM account_deletion_requests WHERE user_id = $1 AND status = 'pending'`,
      [userId],
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }

    const result = await this.db.query(
      `INSERT INTO account_deletion_requests (id, user_id, email, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, email, reason, status, requested_at`,
      [crypto.randomUUID(), userId, user.email, reason || null],
    );
    return result.rows[0];
  }
}
