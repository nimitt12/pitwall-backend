const express = require('express');
const router = express.Router();
const resultController = require('../controllers/resultController');

/**
 * @swagger
 * /results/sync-results:
 *   get:
 *     summary: Sync race results
 *     tags: [Results]
 *     responses:
 *       200:
 *         description: Sync successful
 */
router.get('/sync-results', resultController.syncResults);

/**
 * @swagger
 * /results/get-all-results/{season}/{round}:
 *   get:
 *     summary: Get results by season and round
 *     tags: [Results]
 *     parameters:
 *       - in: path
 *         name: season
 *         required: true
 *         schema:
 *           type: string
 *         description: The season year
 *       - in: path
 *         name: round
 *         required: true
 *         schema:
 *           type: string
 *         description: The race round number
 *     responses:
 *       200:
 *         description: Race results for the specified season and round
 */
router.get('/get-all-results/:season/:round', resultController.getResultsBySeasonAndRound);

/**
 * @swagger
 * /results/get-stats-overall/{season}:
 *   get:
 *     summary: Get overall statistics for a season
 *     tags: [Results]
 *     parameters:
 *       - in: path
 *         name: season
 *         required: true
 *         schema:
 *           type: string
 *         description: The season year
 *     responses:
 *       200:
 *         description: Overall statistics for the season
 */
router.get('/get-stats-overall/:season', resultController.getStatsOverall);

module.exports = router;
