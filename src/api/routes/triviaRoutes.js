const express = require('express');
const router = express.Router();
const triviaController = require('../controllers/triviaController');

/**
 * @swagger
 * /trivia:
 *   get:
 *     summary: Get the homepage ticker trivia lines
 *     tags: [Trivia]
 *     description: Public read of the short trivia sentences scrolled in the homepage ticker (managed via the admin portal's `trivia` table), ordered by sort_order.
 *     responses:
 *       200:
 *         description: Array of trivia lines
 */
router.get('/', triviaController.getTrivia);

module.exports = router;
