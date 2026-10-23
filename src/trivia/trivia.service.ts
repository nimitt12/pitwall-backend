import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class TriviaService {
  /**
   * Read the trivia lines shown in the homepage ticker, ordered by sort_order
   * (then most-recently edited). Managed via the admin portal's "trivia" table.
   * @returns {Promise<Array<{ id: string, body: string }>>}
   */
  getTriviaFromDb = async () => {
    const result = await this.db.query(
      `SELECT id, body FROM trivia ORDER BY sort_order ASC, updated_at DESC`,
    );
    return result.rows;
  };

  constructor(private readonly db: DatabaseService) {}
}
