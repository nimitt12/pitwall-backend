const express = require('express');
const router = express.Router();
const constructorController = require('../controllers/constructorController');

// GET /constructors
router.get('/', constructorController.getConstructors);

module.exports = router;
