const express = require('express');
const router = express.Router();
const raceController = require('../controllers/raceController');

/**
 * @swagger
 * /races:
 *   get:
 *     summary: Get the race calendar
 *     tags: [Races]
 *     description: Public read of the race calendar from the database (managed via the admin portal's `races` table). Returns nested Ergast/Jolpica-shaped Race objects ordered by round.
 *     parameters:
 *       - in: query
 *         name: season
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter the calendar to a single season (e.g. 2026)
 *     responses:
 *       200:
 *         description: Array of races
 */
router.get('/', raceController.getRaces);

module.exports = router;
