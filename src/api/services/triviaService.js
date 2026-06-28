const db = require('../../config/database');

/**
 * Read the trivia lines shown in the homepage ticker, ordered by sort_order
 * (then most-recently edited). Managed via the admin portal's "trivia" table.
 * @returns {Promise<Array<{ id: string, body: string }>>}
 */
const getTriviaFromDb = async () => {
    const result = await db.query(
        `SELECT id, body FROM trivia ORDER BY sort_order ASC, updated_at DESC`
    );
    return result.rows;
};

module.exports = {
    getTriviaFromDb,
};
