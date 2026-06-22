const db = require('../../config/database');

/**
 * Build a `{ date, time }` session object, or undefined when the round has no
 * such session (e.g. a sprint weekend has no FP2/FP3).
 */
const session = (date, time) => (date ? { date, time: time || undefined } : undefined);

/**
 * Reshape a flat `races` row into the nested Ergast/Jolpica-style Race object
 * the frontend expects (mirrors the shape in f1 `src/data/races.ts`).
 */
const toRace = (row) => {
    const race = {
        season: row.season,
        round: row.round,
        raceName: row.race_name,
        url: row.url || undefined,
        Circuit: {
            circuitId: row.circuit_id || undefined,
            url: row.circuit_url || undefined,
            circuitName: row.circuit_name,
            Location: {
                lat: row.lat || undefined,
                long: row.long || undefined,
                locality: row.locality,
                country: row.country,
            },
        },
        date: row.date,
        time: row.time || undefined,
        FirstPractice: session(row.fp1_date, row.fp1_time),
        SecondPractice: session(row.fp2_date, row.fp2_time),
        ThirdPractice: session(row.fp3_date, row.fp3_time),
        Qualifying: session(row.quali_date, row.quali_time),
        Sprint: session(row.sprint_date, row.sprint_time),
        SprintQualifying: session(row.sprint_quali_date, row.sprint_quali_time),
    };
    // Drop undefined session keys so the payload matches the bundled snapshot.
    for (const key of [
        'FirstPractice', 'SecondPractice', 'ThirdPractice',
        'Qualifying', 'Sprint', 'SprintQualifying',
    ]) {
        if (!race[key]) delete race[key];
    }
    return race;
};

/**
 * Read the full race calendar from the local database, ordered by round.
 * Optionally filtered by season. Returns nested Race objects.
 * @param {string} [season]
 * @returns {Promise<Array>}
 */
const getRacesFromDb = async (season) => {
    const params = [];
    let where = '';
    if (season) {
        params.push(String(season));
        where = 'WHERE season = $1';
    }
    const result = await db.query(
        `SELECT * FROM races ${where} ORDER BY (round)::int ASC`,
        params
    );
    return result.rows.map(toRace);
};

module.exports = {
    getRacesFromDb,
};
