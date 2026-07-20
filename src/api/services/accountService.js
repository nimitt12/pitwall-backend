const db = require('../../config/database');
const crypto = require('crypto');

// See sql/account_deletion_requests.sql. Also created lazily here (like
// profileService's ensureColumns) so the endpoint works even on a DB the
// migration file hasn't been run against yet.
let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  await db.query(`
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
  tableEnsured = true;
}

class AccountService {
  /**
   * Record a self-service account deletion request for an admin to action.
   * The `users` row itself is untouched here — deletion is actioned manually
   * from the admin portal, mirroring the 30-day window already described in
   * the privacy policy.
   */
  async createDeletionRequest(userId, { email, reason }) {
    await ensureTable();

    const userResult = await db.query('SELECT id, email FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      throw Object.assign(new Error('Account not found'), { status: 404 });
    }
    if (String(user.email).toLowerCase() !== String(email).toLowerCase()) {
      throw Object.assign(new Error('Email does not match the signed-in account'), { status: 400 });
    }

    const existing = await db.query(
      `SELECT id FROM account_deletion_requests WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }

    const result = await db.query(
      `INSERT INTO account_deletion_requests (id, user_id, email, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, email, reason, status, requested_at`,
      [crypto.randomUUID(), userId, user.email, reason || null]
    );
    return result.rows[0];
  }
}

module.exports = new AccountService();
