// db/connection.js
// PostgreSQL connection pool using 'pg' library

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'payerportal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,                  // max connections in pool
  idleTimeoutMillis: 30000, // close idle clients after 30s
  connectionTimeoutMillis: 2000,
});

// Ensure server-side timestamps are generated in US time (Eastern).
// This affects NOW()/CURRENT_TIMESTAMP and timestamp parsing for date filters.
pool.on('connect', (client) => {
  client.query(`SET TIME ZONE 'America/New_York';`).catch(() => {});
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('   Check your .env DB credentials.');
  } else {
    console.log('✅ PostgreSQL connected successfully');
    release();
  }
});

// Helper: run a query with automatic error logging
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DB] Query (${duration}ms):`, text.substring(0, 80));
    }
    return res;
  } catch (err) {
    console.error('[DB] Query error:', err.message);
    console.error('[DB] Query was:', text);
    throw err;
  }
};

module.exports = { pool, query };
