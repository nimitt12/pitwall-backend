const express = require('express');
const router = express.Router();
const constructorController = require('../controllers/constructorController');

// GET /constructors
router.get('/', constructorController.getConstructors);

// GET all constructors from DB
router.get('/get-all-constructors', constructorController.getAllDbConstructors);

// sync constructor season table form external API
router.get('/sync-constructor-season', constructorController.syncConstructorSeason);

module.exports = router;
