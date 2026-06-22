const raceService = require('../services/raceService');

/**
 * Controller to return the race calendar from the database.
 * Optional `?season=2026` query param filters by season.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getRaces = async (req, res) => {
    try {
        const races = await raceService.getRacesFromDb(req.query.season);
        res.json(races);
    } catch (error) {
        console.error('Error in getRaces controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch race calendar' });
    }
};

module.exports = {
    getRaces,
};
