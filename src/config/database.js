const { Pool } = require('pg');

// Create a new pool using environment variables
const pool = new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT || 5432,
    ssl: {
        rejectUnauthorized: false // Required for Supabase/AWS RDS in many cases
    }
});

// Log successful connection
pool.on('connect', () => {
    console.log('Database pool connected successfully');
});

// Log pool errors
pool.on('error', (err) => {
    console.error('Unexpected error on idle database client', err);
    process.exit(-1);
});

module.exports = {
    /**
     * Execute a SQL query
     * @param {string} text 
     * @param {any[]} params 
     * @returns {Promise<import('pg').QueryResult>}
     */
    query: (text, params) => pool.query(text, params),
    pool
};
