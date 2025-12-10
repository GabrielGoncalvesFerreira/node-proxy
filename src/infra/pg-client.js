import pkg from 'pg';
import { config } from '../config/env.js';
const { Pool } = pkg;

if (!config.databaseUrl) {
  console.warn('[PG] DATABASE_URL not configured, pg client will not connect.');
}

const pool = new Pool({
  connectionString: config.databaseUrl || process.env.DATABASE_URL,
  // optional tuning
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('[PG] unexpected error on idle client', err);
});

export default pool;
