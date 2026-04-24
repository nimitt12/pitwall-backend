const express = require('express');
const cors = require('cors');
const routes = require('./api/routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Simple request logger middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// API Routes mounting
app.use('/', routes);

module.exports = app;
