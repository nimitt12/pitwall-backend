const db = require('../../config/database');
const axios = require('axios');

/**
 * Fetches all drivers from the database
 * @returns {Promise<Array>}
 */
const getAllDriversFromDb = async () => {
    try {
        const result = await db.query('SELECT * FROM drivers ORDER BY family_name ASC');
        return result.rows;
    } catch (error) {
        console.error('Error fetching drivers from database:', error.message);
        throw error;
    }
};

/**
 * Syncs driver season data from external API to local database
 * @returns {Promise<Object>}
 */
const syncDriverSeason = async () => {
    try {
        const response = await axios.get('https://api.jolpi.ca/ergast/f1/2026/driverstandings/?format=json');
        const standingsList = response.data.MRData.StandingsTable.StandingsLists[0];
        const season = standingsList.season;
        const rounds = standingsList.round;
        const driverStandings = standingsList.DriverStandings;

        // Fetch local drivers for mapping slugs to IDs
        const localDrivers = await getAllDriversFromDb();
        const driverMap = {};

        localDrivers.forEach(d => {
            // Using lowercase family name as a safe key for mapping
            const familyName = d.family_name.toLowerCase().replace(/ /g, '_');
            driverMap[familyName] = d.id;

            // Special cases mapping if any (e.g. "bearman" -> "bearman", "antonelli" -> "antonelli")
            // The API driverId is usually the family name
        });

        // Insert or update drivers in the database
        const insertQuery = `
            INSERT INTO drivers_season (id, driver_id, season, points, wins, rounds, position)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE
            SET points = EXCLUDED.points, wins = EXCLUDED.wins, rounds = EXCLUDED.rounds, position = EXCLUDED.position
        `;

        const values = driverStandings.map(item => {
            const apiSlug = item.Driver.driverId;
            const dbId = driverMap[apiSlug];

            if (!dbId) {
                console.warn(`Warning: No mapping found for external driver ID: ${apiSlug}`);
                return null;
            }

            // Generate a unique text ID for the season entry
            const entryId = `${dbId}_${season}`;

            return [
                entryId,
                dbId,
                season.toString(),
                item.points.toString(),
                item.wins.toString(),
                rounds.toString(),
                item.position.toString()
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
            message: 'Driver season synced successfully',
            count: values.length,
            data: driverStandings
        };
    } catch (error) {
        console.error('Error syncing driver season:', error.message);
        await db.query('ROLLBACK');
        throw error;
    }
};

/**
 * Fetches all driver season rankings from the database
 * @returns {Promise<Array>}
 */
const getAllDriversSeasonRankingsFromDb = async () => {
    try {
        const result = await db.query(`
            SELECT ds.*, d.given_name, d.family_name, d.code, d.number, d.nationality, c.name as constructor_name
            FROM drivers_season ds
            JOIN drivers d ON ds.driver_id = d.id
            LEFT JOIN constructors c ON d.constructor_id = c.id
            ORDER BY season DESC, CAST(points AS NUMERIC) DESC`);
        return result.rows;
    } catch (error) {
        console.error('Error fetching driver season rankings from database:', error.message);
        throw error;
    }
};

module.exports = {
    getAllDriversFromDb,
    syncDriverSeason,
    getAllDriversSeasonRankingsFromDb
};
