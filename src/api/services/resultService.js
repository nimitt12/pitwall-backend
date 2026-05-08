const db = require('../../config/database');
const axios = require('axios');

/**
 * Syncs race results from external API to local database
 * @returns {Promise<Object>}
 */
const syncResults = async () => {
    try {
        let totalCount = 0;
        let offset = 0;
        const limit = 100; // Fetch 100 results per request
        let hasMore = true;

        await db.query('BEGIN');

        while (hasMore) {
            const url = `https://api.jolpi.ca/ergast/f1/2026/results/?format=json&limit=${limit}&offset=${offset}`;
            console.log(`Syncing results: offset ${offset}, limit ${limit}...`);

            const response = await axios.get(url);
            const mrData = response.data.MRData;
            const races = mrData.RaceTable.Races;
            const total = parseInt(mrData.total);

            if (!races || races.length === 0) {
                hasMore = false;
                break;
            }

            const insertQuery = `
                INSERT INTO results (
                    id, season, round, driver_number, position, points, grid, laps, status, 
                    time, fastest_lap, fastest_lap_rank, fastest_lap_time
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (id) DO UPDATE
                SET 
                    driver_number = EXCLUDED.driver_number,
                    position = EXCLUDED.position,
                    points = EXCLUDED.points,
                    grid = EXCLUDED.grid,
                    laps = EXCLUDED.laps,
                    status = EXCLUDED.status,
                    time = EXCLUDED.time,
                    fastest_lap = EXCLUDED.fastest_lap,
                    fastest_lap_rank = EXCLUDED.fastest_lap_rank,
                    fastest_lap_time = EXCLUDED.fastest_lap_time,
                    updated_at = NOW()
            `;

            for (const race of races) {
                const season = race.season;
                const round = race.round;
                const results = race.Results;

                for (const item of results) {
                    const driverId = item.Driver.driverId;
                    const id = `${season}_${round}_${driverId}`;

                    const values = [
                        id,
                        season,
                        round,
                        item.number,
                        item.position,
                        item.points,
                        item.grid,
                        item.laps,
                        item.status,
                        item.Time ? item.Time.time : null,
                        item.FastestLap ? item.FastestLap.lap : null,
                        item.FastestLap ? item.FastestLap.rank : null,
                        item.FastestLap && item.FastestLap.Time ? item.FastestLap.Time.time : null
                    ];

                    await db.query(insertQuery, values);
                    totalCount++;
                }
            }

            offset += limit;
            if (offset >= total) {
                hasMore = false;
            }
        }

        await db.query('COMMIT');

        return {
            success: true,
            message: `Successfully synced ${totalCount} results`,
            total: totalCount
        };
    } catch (error) {
        console.error('Error syncing results:', error.message);
        await db.query('ROLLBACK');
        throw error;
    }
};

/**
 * Fetches results by season and round from the database, including driver and constructor info
 * @param {string} season
 * @param {string} round
 * @returns {Promise<Array>}
 */
const getResultsBySeasonAndRoundFromDb = async (season, round) => {
    try {
        const query = `
            SELECT 
                r.*, 
                d.given_name, d.family_name, d.code, d.nationality,
                c.name as team_name
            FROM results r
            LEFT JOIN drivers d ON r.driver_number = d.number
            LEFT JOIN constructors c ON d.constructor_id = c.id
            WHERE r.season = $1 AND r.round = $2
            ORDER BY CAST(r.position AS INTEGER) ASC
        `;
        const result = await db.query(query, [season, round]);
        return result.rows;
    } catch (error) {
        console.error('Error fetching results from database:', error.message);
        throw error;
    }
};

/**
 * Fetches statistics overall for ticker from the database, including driver and constructor info
 * @param {string} season
 * @returns {Promise<Array>}
 */
const getStatsOverallFromDb = async (season) => {
    try {

        // get top driver for ticker
        const driverQuery = `
            SELECT
                ds.points,
                d.family_name
            FROM drivers_season ds
            LEFT JOIN drivers d ON ds.driver_id = d.id
            WHERE ds.season = $1
            ORDER BY ds.points DESC LIMIT 1;
        `;
        const driverResult = await db.query(driverQuery, [season]);

        // get top constructor for ticker
        const constructorQuery = `
            SELECT
                cs.points,
                c.name
            FROM constructors_season cs
            LEFT JOIN constructors c ON cs.constructors_id = c.id::integer
            WHERE cs.season = $1
            ORDER BY cs.points DESC LIMIT 1;
        `;
        const constructorResult = await db.query(constructorQuery, [season]);

        // get youngest driver
        const youngestDriverQuery = `
            select d.family_name, ds.points
                from drivers d
                INNER JOIN drivers_season ds ON d.id = ds.driver_id
                ORDER BY d.dob DESC
                LIMIT 1;
        `;
        const youngestDriverResult = await db.query(youngestDriverQuery);

        // get maximum poles this season
        const polesQuery = `
            SELECT driver_number, COUNT(*) AS pole_positions, d.family_name
            FROM results
            INNER JOIN drivers d on d.number = results.driver_number
            WHERE season = $1 AND grid = '1'
            GROUP BY driver_number, d,family_name
            ORDER BY pole_positions DESC
            LIMIT 1;
        `;
        const polesResult = await db.query(polesQuery, [season]);

        const tickerData = {
            topDriver: driverResult.rows[0].family_name,
            topDriverPoints: driverResult.rows[0].points,
            topConstructor: constructorResult.rows[0].name,
            topConstructorPoints: constructorResult.rows[0].points,
            youngestDriver: youngestDriverResult.rows[0].family_name,
            youngestDriverPoints: youngestDriverResult.rows[0].points,
            maxPoles: polesResult.rows[0].family_name,
            maxPolesCount: polesResult.rows[0].pole_positions,
        }

        return tickerData;
    } catch (error) {
        console.error('Error fetching statistics from database:', error.message);
        throw error;
    }
};

/**
 * Syncs qualifying results from external API to local database
 * @returns {Promise<Object>}
 */
const syncQualifying = async () => {
    try {
        let totalCount = 0;
        let offset = 0;
        const limit = 100; // Fetch 100 results per request
        let hasMore = true;

        await db.query('BEGIN');

        while (hasMore) {
            const url = `https://api.jolpi.ca/ergast/f1/2026/qualifying/?format=json&limit=${limit}&offset=${offset}`;
            console.log(`Syncing qualifying results: offset ${offset}, limit ${limit}...`);

            const response = await axios.get(url);
            const mrData = response.data.MRData;
            const races = mrData.RaceTable.Races;
            const total = parseInt(mrData.total);

            if (!races || races.length === 0) {
                hasMore = false;
                break;
            }

            const insertQuery = `
                INSERT INTO qualifying (
                    id, season, round, driver_number, position, q1, q2, q3
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO UPDATE
                SET 
                    driver_number = EXCLUDED.driver_number,
                    position = EXCLUDED.position,
                    q1 = EXCLUDED.q1,
                    q2 = EXCLUDED.q2,
                    q3 = EXCLUDED.q3,
                    updated_at = NOW()
            `;

            for (const race of races) {
                const season = race.season;
                const round = race.round;
                const qualifyingResults = race.QualifyingResults;

                for (const item of qualifyingResults) {
                    const driverId = item.Driver.driverId;
                    const id = `${season}_${round}_${driverId}`;

                    const values = [
                        id,
                        season,
                        round,
                        item.number,
                        item.position,
                        item.Q1 || null,
                        item.Q2 || null,
                        item.Q3 || null
                    ];

                    await db.query(insertQuery, values);
                    totalCount++;
                }
            }

            offset += limit;
            if (offset >= total) {
                hasMore = false;
            }
        }

        await db.query('COMMIT');

        return {
            success: true,
            message: `Successfully synced ${totalCount} qualifying results`,
            total: totalCount
        };
    } catch (error) {
        console.error('Error syncing qualifying results:', error.message);
        await db.query('ROLLBACK');
        throw error;
    }
};

/**
 * Fetches qualifying results by season and round from the database, including driver and constructor info
 * @param {string} season
 * @param {string} round
 * @returns {Promise<Array>}
 */
const getQualifyingBySeasonAndRoundFromDb = async (season, round) => {
    try {
        const query = `
            SELECT 
                q.*, 
                d.given_name, d.family_name, d.code, d.nationality,
                c.name as team_name
            FROM qualifying q
            LEFT JOIN drivers d ON q.driver_number = d.number
            LEFT JOIN constructors c ON d.constructor_id = c.id
            WHERE q.season = $1 AND q.round = $2
            ORDER BY CAST(q.position AS INTEGER) ASC
        `;
        const result = await db.query(query, [season, round]);
        return result.rows;
    } catch (error) {
        console.error('Error fetching qualifying results from database:', error.message);
        throw error;
    }
};

module.exports = {
    syncResults,
    syncQualifying,
    getResultsBySeasonAndRoundFromDb,
    getQualifyingBySeasonAndRoundFromDb,
    getStatsOverallFromDb
};
