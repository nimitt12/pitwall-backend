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

module.exports = {
    getConstructorStandings,
    getAllConstructorsFromDb
};
