const express = require('express');
const router = express.Router();
const constructorRoutes = require('./constructorRoutes');
const db = require('../../config/database');

// Health check route
router.get('/health', (req, res) => {
    res.json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Database connectivity test route
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

module.exports = router;
