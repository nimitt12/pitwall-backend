const axios = require('axios');
const db = require('../../config/database');

/**
 * Fetches 2026 constructor standings from Ergast API
 * @returns {Promise<Object>}
 */
const getConstructorStandings = async () => {
    const response = await axios.get('https://api.jolpi.ca/ergast/f1/2026/constructorstandings/?format=json');
    return response.data;
};

/**
 * Fetches all constructors from the local database
 * @returns {Promise<Array>}
 */
const getAllConstructorsFromDb = async () => {
    const result = await db.query('SELECT * FROM constructors ORDER BY id ASC');
    return result.rows;
};

/**
 * Sync constructor season table from external API
 * @returns {Promise<Object>}
 */
const syncConstructorSeason = async () => {
    try {
        const response = await axios.get('https://api.jolpi.ca/ergast/f1/2026/constructorstandings/?format=json');
        const standingsList = response.data.MRData.StandingsTable.StandingsLists[0];
        const season = standingsList.season;
        const rounds = standingsList.round;
        const constructorSeason = standingsList.ConstructorStandings;

        // Fetch local constructors for mapping slugs to IDs
        const localConstructors = await getAllConstructorsFromDb();
        const constructorMap = {};

        localConstructors.forEach(c => {
            const name = c.name.toLowerCase();
            if (name.includes('mercedes')) constructorMap['mercedes'] = c.id;
            else if (name.includes('ferrari')) constructorMap['ferrari'] = c.id;
            else if (name.includes('mclaren')) constructorMap['mclaren'] = c.id;
            else if (name.includes('haas')) constructorMap['haas'] = c.id;
            else if (name.includes('alpine')) constructorMap['alpine'] = c.id;
            else if (name.includes('red bull')) constructorMap['red_bull'] = c.id;
            else if (name.includes('rb f1')) constructorMap['rb'] = c.id;
            else if (name.includes('audi')) constructorMap['audi'] = c.id;
            else if (name.includes('williams')) constructorMap['williams'] = c.id;
            else if (name.includes('cadillac')) constructorMap['cadillac'] = c.id;
            else if (name.includes('aston martin')) constructorMap['aston_martin'] = c.id;
        });

        // Insert or update constructors in the database
        const insertQuery = `
            INSERT INTO constructors_season (id, constructors_id, season, points, wins, rounds)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE
            SET points = EXCLUDED.points, wins = EXCLUDED.wins, rounds = EXCLUDED.rounds
        `;

        const values = constructorSeason.map(item => {
            const apiSlug = item.Constructor.constructorId;
            const dbId = constructorMap[apiSlug];

            if (!dbId) {
                console.warn(`Warning: No mapping found for external constructor ID: ${apiSlug}`);
                return null;
            }

            // Generate a unique text ID for the season entry (as per DB schema)
            const entryId = `${dbId}_${season}`;

            return [
                entryId,
                dbId,
                season,
                item.points,
                item.wins,
                rounds
            ];
        }).filter(v => v !== null);

        // Use transaction for batch insert/update
        await db.query('BEGIN');
        for (const value of values) {
            await db.query(insertQuery, value);
        }
        await db.query('COMMIT');

        return {
            success: true,
            message: 'Constructor season synced successfully',
            count: values.length,
            data: constructorSeason
        };
    } catch (error) {
        console.error('Error syncing constructor season:', error.message);
        // Rollback transaction if something goes wrong
        await db.query('ROLLBACK');
        throw error;
    }
};

// get all constructors season rankings from DB
const getAllConstructorsSeasonRankingsFromDb = async () => {
    try {
        const result = await db.query(`
            SELECT cs.*, c.name 
            FROM constructors_season cs 
            JOIN constructors c ON cs.constructors_id = c.id::integer
            ORDER BY season DESC, points DESC`);
        return result.rows;
    } catch (error) {
        console.error('Error fetching constructors season rankings from database:', error.message);
        throw error;
    }
};

module.exports = {
    getConstructorStandings,
    getAllConstructorsFromDb,
    syncConstructorSeason,
    getAllConstructorsSeasonRankingsFromDb
};
