const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// API to get constructor standings for 2026
app.get('/constructors', async (req, res) => {
    try {
        const response = await axios.get('https://api.jolpi.ca/ergast/f1/2026/constructorstandings/?format=json');
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching constructor standings:', error.message);
        res.status(500).json({ error: 'Failed to fetch constructor standings' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
