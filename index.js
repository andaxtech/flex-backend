const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_secret';

app.use(cors());
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.send('Flex Backend is Running with Updated DB!');
});

// Get available blocks
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

// Register user only
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

// Get claimed blocks
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

// SIGNUP DRIVER (with transaction)
app.post('/signup-driver', async (req, res) => {
  const client = await pool.connect();
  const {
    username,
    password,
    email,
    first_name,
    last_name,
    phone_number,
    birth_date,
    license_number,
    license_expiration,
    car_make,
    car_model,
    car_year,
    car_color,
    license_plate,
    vin_number,
    insurance_provider,
    insurance_policy_number,
    policy_start_date,
    policy_end_date,
    account_holder_first_name,
    account_holder_last_name,
    bank_name,
    bank_account_number,
    routing_number
  } = req.body;

  try {
    await client.query('BEGIN');

    const password_hash = await bcrypt.hash(password, 10);

    const userResult = await client.query(
      'INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING user_id',
      [username, password_hash, email]
    );
    const user_id = userResult.rows[0].user_id;

    const driverResult = await client.query(
      `INSERT INTO drivers 
        (user_id, first_name, last_name, phone_number, email, license_number, license_expiration, birth_date, registration_date, status) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9) RETURNING driver_id`,
      [user_id, first_name, last_name, phone_number, email, license_number, license_expiration, birth_date, 'pending']
    );
    const driver_id = driverResult.rows[0].driver_id;

    await client.query(
      `INSERT INTO car_details 
        (driver_id, make, model, year, color, license_plate, vin_number) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [driver_id, car_make, car_model, car_year, car_color, license_plate, vin_number]
    );

    await client.query(
      `INSERT INTO insurance_details 
        (driver_id, provider, policy_number, start_date, end_date) 
        VALUES ($1, $2, $3, $4, $5)`,
      [driver_id, insurance_provider, insurance_policy_number, policy_start_date, policy_end_date]
    );

    await client.query(
      `INSERT INTO driver_banking_info 
        (driver_id, account_holder_first_name, account_holder_last_name, bank_name, account_number, routing_number) 
        VALUES ($1, $2, $3, $4, $5, $6)`,
      [driver_id, account_holder_first_name, account_holder_last_name, bank_name, bank_account_number, routing_number]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Driver registration complete and will be reviewed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  } finally {
    client.release();
  }
});

// LOGIN
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = userRes.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const payload = { user_id: user.user_id };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
