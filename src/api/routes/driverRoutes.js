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

module.exports = router;
