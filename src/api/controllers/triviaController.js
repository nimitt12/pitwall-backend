const triviaService = require('../services/triviaService');

/**
 * Controller to return the ticker trivia lines from the database.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getTrivia = async (req, res) => {
    try {
        const trivia = await triviaService.getTriviaFromDb();
        res.json(trivia);
    } catch (error) {
        console.error('Error in getTrivia controller:', error.message);
        res.status(500).json({ error: 'Failed to fetch trivia' });
    }
};

module.exports = {
    getTrivia,
};
