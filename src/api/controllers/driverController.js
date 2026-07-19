const driverService = require('../services/driverService');

const getAllDbDrivers = async (req, res) => {
    try {
        const drivers = await driverService.getAllDriversFromDb();
        res.json(drivers);
    } catch (error) {
        console.error('Error in getAllDbDrivers controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch drivers from database' });
    }
};

/**
 * Controller to handle syncing driver season data from external API
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
const syncDriverSeason = async (req, res) => {
    try {
        const result = await driverService.syncDriverSeason();
        res.json(result);
    } catch (error) {
        console.error('Error in syncDriverSeason controller:', error.message);
        res.status(500).json({ error: 'Failed to sync driver season data' });
    }
};

/**
 * Controller to handle fetching all driver season rankings from DB
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
const getAllDbDriversSeasonRankings = async (req, res) => {
    try {
        const driversSeasonRankings = await driverService.getAllDriversSeasonRankingsFromDb();
        res.json(driversSeasonRankings);
    } catch (error) {
        console.error('Error in getAllDbDriversSeasonRankings controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch driver season rankings from database' });
    }
};

/**
 * Controller to handle fetching a head-to-head comparison between two drivers
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getDriverComparison = async (req, res) => {
    try {
        const { season, driverId1, driverId2 } = req.params;
        const comparison = await driverService.getDriverComparisonFromDb(season, driverId1, driverId2);
        if (!comparison) {
            return res.status(404).json({ error: 'One or both drivers not found for this season' });
        }
        res.json(comparison);
    } catch (error) {
        console.error('Error in getDriverComparison controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch driver comparison' });
    }
};

module.exports = {
    getAllDbDrivers,
    syncDriverSeason,
    getAllDbDriversSeasonRankings,
    getDriverComparison
};
