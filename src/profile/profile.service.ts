import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class ProfileService {
  // Preferences live on the `users` table (formerly `profiles`). Ensure the
  // columns exist on first use so a DB that predates the feature still works.
  columnsEnsured = false;

  ensureColumns = async () => {
    if (process.env.NODE_ENV === 'production') return;
    if (this.columnsEnsured) return;
    await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_constructor TEXT`);
    await this.db.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_drivers TEXT[] DEFAULT '{}'`,
    );
    this.columnsEnsured = true;
  };

  PROFILE_COLUMNS = 'id, email, full_name, avatar_url, fav_constructor, fav_drivers';

  constructor(private readonly db: DatabaseService) {}

  async getProfile(id: string) {
    await this.ensureColumns();
    const result = await this.db.query(`SELECT ${this.PROFILE_COLUMNS} FROM users WHERE id = $1`, [
      id,
    ]);
    return result.rows[0] || null;
  }

  async updateProfile(
    id: string,
    { fav_constructor, fav_drivers }: { fav_constructor?: string; fav_drivers?: unknown },
  ) {
    await this.ensureColumns();

    const drivers = Array.isArray(fav_drivers)
      ? fav_drivers.filter((d) => typeof d === 'string').slice(0, 2)
      : [];

    const result = await this.db.query(
      `UPDATE users
         SET fav_constructor = $1,
             fav_drivers = $2,
             updated_at = NOW()
       WHERE id = $3
       RETURNING ${this.PROFILE_COLUMNS}`,
      [fav_constructor || null, drivers, id],
    );
    return result.rows[0] || null;
  }
}
