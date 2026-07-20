const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');

/**
 * @swagger
 * tags:
 *   name: Account
 *   description: Self-service account actions
 */

/**
 * @swagger
 * /account/delete-request:
 *   post:
 *     summary: Request deletion of an account and its associated data
 *     tags: [Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, email]
 *             properties:
 *               userId:
 *                 type: string
 *               email:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Deletion request recorded
 *       400:
 *         description: Missing fields or email mismatch
 *       404:
 *         description: Account not found
 */
router.post('/delete-request', accountController.requestDeletion);

module.exports = router;
