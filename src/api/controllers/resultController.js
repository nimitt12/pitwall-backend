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

/**
 * Controller to handle fetching statistics overall for ticker
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
const getStatsOverall = async (req, res) => {
    try {
        const { season } = req.params;
        const stats = await resultService.getStatsOverallFromDb(season);
        res.json(stats);
    } catch (error) {
        console.error('Error in getStatsOverall controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch statistics from database' });
    }
};

/**
 * Controller to handle syncing qualifying results from external API
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
const syncQualifying = async (req, res) => {
    try {
        const result = await resultService.syncQualifying();
        res.json(result);
    } catch (error) {
        console.error('Error in syncQualifying controller:', error.message);
        res.status(500).json({ error: 'Failed to sync qualifying results' });
    }
};

/**
 * Controller to handle fetching qualifying results by season and round from DB
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
const getQualifyingBySeasonAndRound = async (req, res) => {
    try {
        const { season, round } = req.params;
        const results = await resultService.getQualifyingBySeasonAndRoundFromDb(season, round);
        res.json(results);
    } catch (error) {
        console.error('Error in getQualifyingBySeasonAndRound controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch qualifying results from database' });
    }
};

/**
 * Controller to handle syncing sprint race results from external API
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const syncSprintResults = async (req, res) => {
    try {
        const result = await resultService.syncSprintResults();
        res.json(result);
    } catch (error) {
        console.error('Error in syncSprintResults controller:', error.message);
        res.status(500).json({ error: 'Failed to sync sprint results' });
    }
};

/**
 * Controller to handle syncing sprint qualifying results from external API
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const syncSprintQualifying = async (req, res) => {
    try {
        const result = await resultService.syncSprintQualifying();
        res.json(result);
    } catch (error) {
        console.error('Error in syncSprintQualifying controller:', error.message);
        res.status(500).json({ error: 'Failed to sync sprint qualifying results' });
    }
};

/**
 * Controller to handle fetching sprint results by season and round from DB
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getSprintResultsBySeasonAndRound = async (req, res) => {
    try {
        const { season, round } = req.params;
        const results = await resultService.getSprintResultsBySeasonAndRoundFromDb(season, round);
        res.json(results);
    } catch (error) {
        console.error('Error in getSprintResultsBySeasonAndRound controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch sprint results from database' });
    }
};

/**
 * Controller to handle fetching sprint qualifying results by season and round from DB
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getSprintQualifyingBySeasonAndRound = async (req, res) => {
    try {
        const { season, round } = req.params;
        const results = await resultService.getSprintQualifyingBySeasonAndRoundFromDb(season, round);
        res.json(results);
    } catch (error) {
        console.error('Error in getSprintQualifyingBySeasonAndRound controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch sprint qualifying results from database' });
    }
};

/**
 * Controller to handle fetching lap-by-lap positions from external API
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getLapPositions = async (req, res) => {
    try {
        const { season, round } = req.params;
        const laps = await resultService.getLapPositions(season, round);
        res.json(laps);
    } catch (error) {
        console.error('Error in getLapPositions controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch lap positions' });
    }
};

module.exports = {
    syncResults,
    syncQualifying,
    syncSprintResults,
    syncSprintQualifying,
    getResultsBySeasonAndRound,
    getQualifyingBySeasonAndRound,
    getSprintResultsBySeasonAndRound,
    getSprintQualifyingBySeasonAndRound,
    getStatsOverall,
    getLapPositions
};
