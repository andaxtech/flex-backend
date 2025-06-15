const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt'); // Added for password hashing
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

// Get all available blocks
app.get('/blocks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM blocks WHERE status = $1', ['available']);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Claim a block
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

// Get all drivers
app.get('/drivers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM drivers WHERE status = $1', ['active']);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Register user only (existing route)
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

// Get claimed blocks for a driver
app.get('/claims', async (req, res) => {
  const { driver_id } = req.query;
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

// NEW: Sign up a driver and create user login
app.post('/signup-driver', async (req, res) => {
  const {
    username,
    password,
    email,
    first_name,
    last_name,
    phone_number,
    license_number,
    license_expiration,
    birth_date
  } = req.body;

  try {
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const userResult = await pool.query(
      'INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING user_id',
      [username, password_hash, email]
    );
    const user_id = userResult.rows[0].user_id;

    const driverResult = await pool.query(
      `INSERT INTO drivers 
        (user_id, first_name, last_name, phone_number, email, license_number, license_expiration, birth_date, registration_date, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9) RETURNING *`,
      [user_id, first_name, last_name, phone_number, email, license_number, license_expiration, birth_date, 'pending']
    );

    res.status(201).json(driverResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
