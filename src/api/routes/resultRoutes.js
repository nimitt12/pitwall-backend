const express = require('express');
const router = express.Router();
const resultController = require('../controllers/resultController');

// GET /results/sync-results
router.get('/sync-results', resultController.syncResults);

// GET /results/get-all-results/:season/:round
router.get('/get-all-results/:season/:round', resultController.getResultsBySeasonAndRound);

// GET statistics overall for ticker
router.get('/get-stats-overall/:season', resultController.getStatsOverall);

module.exports = router;
