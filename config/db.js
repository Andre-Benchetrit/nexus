require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || process.env.PG_HOST,
  port: Number(process.env.POSTGRES_PORT || process.env.PG_PORT),
  database: process.env.POSTGRES_DATABASE || process.env.PG_DATABASE,
  user: process.env.POSTGRES_USER || process.env.PG_USER,
  password: process.env.POSTGRES_PASSWORD || process.env.PG_PASSWORD,
  ssl: false
});

module.exports = pool;
