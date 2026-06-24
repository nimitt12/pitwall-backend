const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');

/**
 * @swagger
 * tags:
 *   name: Profile
 *   description: User profile and saved preferences
 */

/**
 * @swagger
 * /profile/{id}:
 *   get:
 *     summary: Get a user's profile and preferences
 *     tags: [Profile]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile found
 *       404:
 *         description: Profile not found
 */
router.get('/:id', profileController.getProfile);

/**
 * @swagger
 * /profile/{id}:
 *   put:
 *     summary: Update a user's favorite constructor and drivers
 *     tags: [Profile]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fav_constructor:
 *                 type: string
 *               fav_drivers:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Preferences saved
 *       404:
 *         description: Profile not found
 */
router.put('/:id', profileController.updateProfile);

module.exports = router;
