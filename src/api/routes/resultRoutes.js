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
 * /results/sync-qualifying:
 *   get:
 *     summary: Sync qualifying results
 *     tags: [Results]
 *     responses:
 *       200:
 *         description: Sync successful
 */
router.get('/sync-qualifying', resultController.syncQualifying);

/**
 * @swagger
 * /results/sync-sprint-results:
 *   get:
 *     summary: Sync sprint race results
 *     tags: [Results]
 *     responses:
 *       200:
 *         description: Sync successful
 */
router.get('/sync-sprint-results', resultController.syncSprintResults);

/**
 * @swagger
 * /results/sync-sprint-qualifying:
 *   get:
 *     summary: Sync sprint qualifying results
 *     tags: [Results]
 *     responses:
 *       200:
 *         description: Sync successful
 */
router.get('/sync-sprint-qualifying', resultController.syncSprintQualifying);

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
 * /results/get-all-qualifying-results/{season}/{round}:
 *   get:
 *     summary: Get qualifying results by season and round
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
 *         description: Qualifying results for the specified season and round
 */
router.get('/get-all-qualifying-results/:season/:round', resultController.getQualifyingBySeasonAndRound);

/**
 * @swagger
 * /results/get-all-sprint-results/{season}/{round}:
 *   get:
 *     summary: Get sprint results by season and round
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
 *         description: Sprint results for the specified season and round
 */
router.get('/get-all-sprint-results/:season/:round', resultController.getSprintResultsBySeasonAndRound);

/**
 * @swagger
 * /results/get-all-sprint-qualifying-results/{season}/{round}:
 *   get:
 *     summary: Get sprint qualifying results by season and round
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
 *         description: Sprint qualifying results for the specified season and round
 */
router.get('/get-all-sprint-qualifying-results/:season/:round', resultController.getSprintQualifyingBySeasonAndRound);

/**
 * @swagger
 * /results/get-lap-positions/{season}/{round}:
 *   get:
 *     summary: Get lap-by-lap positions for a race
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
 *         description: Per-driver lap-by-lap positions for the specified race
 */
router.get('/get-lap-positions/:season/:round', resultController.getLapPositions);

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
