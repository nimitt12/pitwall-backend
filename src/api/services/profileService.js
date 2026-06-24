const db = require('../../config/database');

// Preferences live on the `users` table (formerly `profiles`). Ensure the
// columns exist on first use so a DB that predates the feature still works.
let columnsEnsured = false;
async function ensureColumns() {
  if (columnsEnsured) return;
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_constructor TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_drivers TEXT[] DEFAULT '{}'`);
  columnsEnsured = true;
}

const PROFILE_COLUMNS =
  'id, email, full_name, avatar_url, fav_constructor, fav_drivers';

class ProfileService {
  /**
   * Fetch a user's public profile + saved preferences.
   */
  async getProfile(id) {
    await ensureColumns();
    const result = await db.query(
      `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Persist a user's favorite constructor and (up to two) drivers.
   * `fav_drivers` is a Postgres text[] — node-pg serializes a JS string array
   * to it directly.
   */
  async updateProfile(id, { fav_constructor, fav_drivers }) {
    await ensureColumns();

    const drivers = Array.isArray(fav_drivers)
      ? fav_drivers.filter((d) => typeof d === 'string').slice(0, 2)
      : [];

    const result = await db.query(
      `UPDATE users
         SET fav_constructor = $1,
             fav_drivers = $2,
             updated_at = NOW()
       WHERE id = $3
       RETURNING ${PROFILE_COLUMNS}`,
      [fav_constructor || null, drivers, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = new ProfileService();
