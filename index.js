const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.send('Flex Backend is Running with Updated DB!');
});

// Get all available blocks (from the 'blocks' table)
app.get('/blocks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM blocks WHERE status = $1', ['available']);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Claim a block (insert into 'block_claims')
app.post('/claim', async (req, res) => {
  const { block_id, driver_id } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO block_claims (block_id, driver_id, claim_time, status) VALUES ($1, $2, NOW(), $3) RETURNING *',
      [block_id, driver_id, 'claimed']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all drivers (from 'drivers' table)
app.get('/drivers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM drivers WHERE status = $1', ['active']);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// User registration (insert into 'users')
app.post('/register', async (req, res) => {
  const { username, password_hash, email } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, email, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
      [username, password_hash, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// NEW: Get claimed blocks for a driver
app.get('/claims', async (req, res) => {
  const { driver_id } = req.query;  // Get driver_id from query string
  try {
    const result = await pool.query(
      'SELECT * FROM block_claims WHERE driver_id = $1',
      [driver_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error fetching claims' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
