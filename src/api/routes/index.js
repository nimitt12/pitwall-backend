const express = require('express');
const router = express.Router();
const constructorRoutes = require('./constructorRoutes');
const driverRoutes = require('./driverRoutes');
const resultRoutes = require('./resultRoutes');
const authRoutes = require('./authRoutes');
const db = require('../../config/database');

const constructorController = require('../controllers/constructorController');
const driverController = require('../controllers/driverController');
const resultController = require('../controllers/resultController');

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: Check if the API is running.
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 timestamp:
 *                   type: string
 */
router.get('/health', (req, res) => {
    res.json({ status: 'UP', timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /get-all-drivers:
 *   get:
 *     summary: Get all drivers from database
 *     description: Retrieve a list of all drivers stored in the local database.
 *     responses:
 *       200:
 *         description: List of drivers
 */
router.get('/get-all-drivers', driverController.getAllDbDrivers);

/**
 * @swagger
 * /db-test:
 *   get:
 *     summary: Test database connection
 *     description: Verify if the backend can connect to the PostgreSQL database.
 *     responses:
 *       200:
 *         description: Connection successful
 *       500:
 *         description: Connection failed
 */
router.get('/db-test', async (req, res) => {
    try {
        const result = await db.query('SELECT NOW()');
        res.json({
            status: 'Connected',
            message: 'Database connection is healthy',
            serverTime: result.rows[0].now
        });
    } catch (error) {
        console.error('Database connection error:', error.message);
        res.status(500).json({
            status: 'Error',
            message: 'Failed to connect to the database',
            error: error.message
        });
    }
});

// Aggregate all API routes
router.use('/constructors', constructorRoutes);
router.use('/drivers', driverRoutes);
router.use('/results', resultRoutes);
router.use('/auth', authRoutes);

module.exports = router;
