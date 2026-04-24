const express = require('express');
const router = express.Router();
const constructorRoutes = require('./constructorRoutes');

// Health check route
router.get('/health', (req, res) => {
    res.json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Aggregate all API routes
router.use('/constructors', constructorRoutes);

module.exports = router;
