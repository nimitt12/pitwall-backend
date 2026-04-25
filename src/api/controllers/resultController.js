const resultService = require('../services/resultService');

/**
 * Controller to handle syncing race results from external API
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
const syncResults = async (req, res) => {
    try {
        const result = await resultService.syncResults();
        res.json(result);
    } catch (error) {
        console.error('Error in syncResults controller:', error.message);
        res.status(500).json({ error: 'Failed to sync race results' });
    }
};

/**
 * Controller to handle fetching results by season and round from DB
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
const getResultsBySeasonAndRound = async (req, res) => {
    try {
        const { season, round } = req.params;
        const results = await resultService.getResultsBySeasonAndRoundFromDb(season, round);
        res.json(results);
    } catch (error) {
        console.error('Error in getResultsBySeasonAndRound controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch race results from database' });
    }
};

module.exports = {
    syncResults,
    getResultsBySeasonAndRound
};
