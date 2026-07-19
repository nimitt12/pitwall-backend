const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');

/**
 * @swagger
 * /drivers/get-all-drivers:
 *   get:
 *     summary: Get all drivers
 *     tags: [Drivers]
 *     responses:
 *       200:
 *         description: List of all drivers
 */
router.get('/get-all-drivers', driverController.getAllDbDrivers);

/**
 * @swagger
 * /drivers/sync-driver-season:
 *   get:
 *     summary: Sync driver season data
 *     tags: [Drivers]
 *     description: Fetch driver data from external F1 API and sync with local database.
 *     responses:
 *       200:
 *         description: Sync successful
 */
router.get('/sync-driver-season', driverController.syncDriverSeason);

/**
 * @swagger
 * /drivers/get-all-drivers-season-rankings:
 *   get:
 *     summary: Get driver season rankings
 *     tags: [Drivers]
 *     responses:
 *       200:
 *         description: List of driver rankings for the season
 */
router.get('/get-all-drivers-season-rankings', driverController.getAllDbDriversSeasonRankings);

/**
 * @swagger
 * /drivers/compare/{season}/{driverId1}/{driverId2}:
 *   get:
 *     summary: Get head-to-head comparison between two drivers for a season
 *     tags: [Drivers]
 *     parameters:
 *       - in: path
 *         name: season
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: driverId1
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: driverId2
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Season stats, last 5 results, and qualifying/race head-to-head counts for both drivers
 *       404:
 *         description: One or both drivers not found for this season
 */
router.get('/compare/:season/:driverId1/:driverId2', driverController.getDriverComparison);

module.exports = router;
