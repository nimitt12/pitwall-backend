const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');

// GET /drivers/get-all-drivers
router.get('/get-all-drivers', driverController.getAllDbDrivers);

// sync driver season table from external API
router.get('/sync-driver-season', driverController.syncDriverSeason);

// get all drivers season rankings from DB
router.get('/get-all-drivers-season-rankings', driverController.getAllDbDriversSeasonRankings);

module.exports = router;
