const constructorService = require('../services/constructorService');

/**
 * Controller to handle fetching constructors
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
const getConstructors = async (req, res) => {
    try {
        const data = await constructorService.getConstructorStandings();
        res.json(data);
    } catch (error) {
        console.error('Error in getConstructors controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch constructor standings' });
    }
};

/**
 * Controller to handle fetching all constructors from DB
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
const getAllDbConstructors = async (req, res) => {
    try {
        const constructors = await constructorService.getAllConstructorsFromDb();
        res.json(constructors);
    } catch (error) {
        console.error('Error in getAllDbConstructors controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch constructors from database' });
    }
};

module.exports = {
    getConstructors,
    getAllDbConstructors
};
