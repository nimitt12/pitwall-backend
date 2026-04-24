const axios = require('axios');

/**
 * Fetches 2026 constructor standings from Ergast API
 * @returns {Promise<Object>}
 */
const getConstructorStandings = async () => {
    const response = await axios.get('https://api.jolpi.ca/ergast/f1/2026/constructorstandings/?format=json');
    return response.data;
};

module.exports = {
    getConstructorStandings
};
