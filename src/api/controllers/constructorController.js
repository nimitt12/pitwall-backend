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

module.exports = {
    getConstructors
};
