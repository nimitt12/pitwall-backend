const express = require('express');
const router = express.Router();
const constructorController = require('../controllers/constructorController');

/**
 * @swagger
 * /constructors:
 *   get:
 *     summary: Get constructors from external API
 *     tags: [Constructors]
 *     responses:
 *       200:
 *         description: List of constructors
 */
router.get('/', constructorController.getConstructors);

/**
 * @swagger
 * /constructors/get-all-constructors:
 *   get:
 *     summary: Get all constructors from DB
 *     tags: [Constructors]
 *     responses:
 *       200:
 *         description: List of all constructors in database
 */
router.get('/get-all-constructors', constructorController.getAllDbConstructors);

/**
 * @swagger
 * /constructors/sync-constructor-season:
 *   get:
 *     summary: Sync constructor season data
 *     tags: [Constructors]
 *     responses:
 *       200:
 *         description: Sync successful
 */
router.get('/sync-constructor-season', constructorController.syncConstructorSeason);

/**
 * @swagger
 * /constructors/get-all-constructors-season-rankings:
 *   get:
 *     summary: Get constructor season rankings
 *     tags: [Constructors]
 *     responses:
 *       200:
 *         description: List of constructor rankings
 */
router.get('/get-all-constructors-season-rankings', constructorController.getAllDbConstructorsSeasonRankings);

module.exports = router;
