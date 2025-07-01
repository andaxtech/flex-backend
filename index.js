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

// ✅ New API: Get all available (unclaimed) blocks with store info, grouped by date
app.get('/api/driver/available-blocks', async (req, res) => {
  const { driver_id } = req.query;
  const driverIdInt = parseInt(driver_id);

  if (!driver_id || isNaN(driverIdInt)) {
    return res.status(400).json({ success: false, message: 'Missing or invalid driver_id' });
  }

  try {
    const query = `
      WITH latest_claims AS (
        SELECT *
        FROM (
          SELECT claim_id, block_id, driver_id, claim_time,
                 ROW_NUMBER() OVER (PARTITION BY block_id ORDER BY claim_time DESC) AS rn
          FROM block_claims
        ) sub
        WHERE rn = 1
      )
      SELECT
        b.block_id,
        b.date,
        b.start_time,
        b.end_time,
        b.amount,
        b.status,
        b.location_id,
        lc.claim_id,
        l.store_id,
        l.street_name,
        l.city,
        l.region,
        l.phone,
        l.postal_code,
        d.license_expiration,
        d.registration_expiration_date,
        i.end_date AS insurance_end
      FROM blocks AS b
      LEFT JOIN latest_claims lc ON b.block_id = lc.block_id
      INNER JOIN locations l ON b.location_id = l.location_id
      INNER JOIN drivers d ON d.driver_id = $1
      LEFT JOIN insurance_details i ON d.driver_id = i.driver_id
      WHERE b.status = 'available'
        AND lc.claim_id IS NULL
        AND d.license_expiration > NOW()
        AND d.registration_expiration_date > NOW()
        AND i.end_date > NOW()
      ORDER BY b.date, b.start_time
    `;

    const result = await pool.query(query, [driverIdInt]);

    // Group blocks by date
    const grouped = {};
    result.rows.forEach((row) => {
      const date = row.date?.toISOString().split('T')[0];
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push({
        block_id: row.block_id,
        startTime: row.start_time?.toISOString() || null,
        endTime: row.end_time?.toISOString() || null,
        amount: row.amount,
        locationId: row.location_id,
        city: row.city,
        region: row.region,
        store: {
          storeId: row.store_id,
          address: `${row.street_name}, ${row.city}, ${row.region} ${row.postal_code}`,
          phone: row.phone
        }
      });
    });

    res.json({ success: true, blocksByDate: grouped });
  } catch (err) {
    console.error('❌ Error fetching available blocks for driver:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Updated /claim API (UTC Only, No Conversion)
app.post('/claim', async (req, res) => {
  const { block_id, driver_id } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Get block details as-is
    const blockRes = await client.query(
      'SELECT block_id, start_time, end_time, location_id FROM blocks WHERE block_id = $1',
      [block_id]
    );
    if (blockRes.rowCount === 0) throw new Error('Block not found');

    const { start_time, end_time, location_id } = blockRes.rows[0];
    const newStart = new Date(start_time);
    const newEnd = new Date(end_time);

    // Step 2: Define start and end of the same calendar day (no timezone math)
    const blockDate = new Date(start_time);
    const startOfDay = new Date(
      blockDate.getFullYear(),
      blockDate.getMonth(),
      blockDate.getDate(),
      0, 0, 0, 0
    );
    const endOfDay = new Date(
      blockDate.getFullYear(),
      blockDate.getMonth(),
      blockDate.getDate(),
      23, 59, 59, 999
    );

    // Step 3: Get all claimed blocks by driver on same date
    const existingClaims = await client.query(
      `
      SELECT b.start_time, b.end_time, b.block_id, b.location_id
      FROM block_claims bc
      JOIN blocks b ON bc.block_id = b.block_id
      WHERE bc.driver_id = $1
        AND b.start_time BETWEEN $2 AND $3
      `,
      [driver_id, startOfDay, endOfDay]
    );

    // Step 4: Check for conflicts (no conversion)
    for (const row of existingClaims.rows) {
      const claimedStart = new Date(row.start_time);
      const claimedEnd = new Date(row.end_time);
      const isOverlap = newStart < claimedEnd //&& newEnd > claimedStart;
      const isConsecutive =
        newStart.getTime() === claimedEnd.getTime(); //||
        //newEnd.getTime() === claimedStart.getTime();
      const isSameLocation = row.location_id === location_id;

      if (isOverlap) {
        throw new Error('Block overlaps with another you’ve claimed.');
      }

      if (isConsecutive && !isSameLocation) {
        throw new Error(
          'You cannot accept consecutive blocks at different store locations.'
        );
      }
    }

    // Step 5: Check if block already claimed
    const dupCheck = await client.query(
      'SELECT 1 FROM block_claims WHERE block_id = $1',
      [block_id]
    );
    if (dupCheck.rowCount > 0) {
      throw new Error('This block has already been claimed.');
    }

    // Step 6: Insert claim
    const claimResult = await client.query(
      `
      INSERT INTO block_claims (block_id, driver_id, claim_time)
      VALUES ($1, $2, NOW())
      RETURNING *
      `,
      [block_id, driver_id]
    );

    // Step 7: Update block status
    await client.query(
      'UPDATE blocks SET status = $1 WHERE block_id = $2',
      ['claimed', block_id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: 'Block claimed successfully',
      data: claimResult.rows[0],
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Claim error:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});




//Unclaim Block Endpoint( with logic 60 min cancellation policy)
app.post('/unclaim', async (req, res) => {
  const { block_id, driver_id, override_penalty } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get block start_time exactly as stored in DB (no conversion)
    const blockResult = await client.query(
      'SELECT start_time FROM blocks WHERE block_id = $1',
      [block_id]
    );

    if (blockResult.rowCount === 0) {
      throw new Error('Block not found');
    }

    const startTime = new Date(blockResult.rows[0].start_time); // use as-is
    const now = new Date(); // also use as-is

    const diffMinutes = (startTime.getTime() - now.getTime()) / (1000 * 60);

    // Warn if unclaim is within 60 minutes and no override
    if (diffMinutes <= 60 && !override_penalty) {
      return res.status(400).json({
        warning: true,
        message: 'Unclaiming now will impact your standing. Confirm to proceed.',
      });
    }

    // Unclaim the block
    await client.query(
      'DELETE FROM block_claims WHERE block_id = $1 AND driver_id = $2',
      [block_id, driver_id]
    );

    // Set block status back to available
    await client.query(
      'UPDATE blocks SET status = $1 WHERE block_id = $2',
      ['available', block_id]
    );

    // Log performance penalty if needed
    if (diffMinutes <= 60) {
      await client.query(
        `
        INSERT INTO driver_performance (driver_id, block_id, issue, created_at)
        VALUES ($1, $2, $3, NOW())
        `,
        [driver_id, block_id, 'Late unclaim within 1 hour']
      );
    }

    await client.query('COMMIT');
    res.status(200).json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Unclaim error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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

// ✅ Refined API: Get claimed blocks with store info, grouped by date
app.get('/api/driver/claimed-blocks', async (req, res) => {
  const { driver_id } = req.query;
  const driverIdInt = parseInt(driver_id);

  if (!driver_id || isNaN(driverIdInt)) {
    return res.status(400).json({ success: false, message: 'Missing or invalid driver_id' });
  }

  try {
    const query = `
      WITH latest_claims AS (
        SELECT *
        FROM (
          SELECT claim_id, block_id, driver_id, claim_time,
                 ROW_NUMBER() OVER (PARTITION BY block_id ORDER BY claim_time DESC) AS rn
          FROM block_claims
          WHERE driver_id = $1
        ) sub
        WHERE rn = 1
      )
      SELECT
        b.block_id,
        b.date,
        b.start_time,
        b.end_time,
        b.amount,
        b.status,
        b.location_id,
        lc.claim_time,
        l.store_id,
        l.street_name,
        l.city,
        l.region,
        l.phone,
        l.postal_code
      FROM latest_claims lc
      INNER JOIN blocks b ON lc.block_id = b.block_id
      INNER JOIN locations l ON b.location_id = l.location_id
      ORDER BY b.date, b.start_time
    `;

    const result = await pool.query(query, [driverIdInt]);

    // Group blocks by date
    const grouped = {};
    result.rows.forEach((row) => {
      const date = row.date?.toISOString().split('T')[0];
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push({
        block_id: row.block_id,
        startTime: row.start_time?.toISOString() || null,
        endTime: row.end_time?.toISOString() || null,
        amount: row.amount,
        status: row.status,
        claimTime: row.claim_time?.toISOString() || null,
        locationId: row.location_id,
        city: row.city,
        region: row.region,
        store: {
          storeId: row.store_id,
          address: `${row.street_name}, ${row.city}, ${row.region} ${row.postal_code}`,
          phone: row.phone
        }
      });
    });

    res.json({ success: true, blocksByDate: grouped });
  } catch (err) {
    console.error('❌ Error fetching claimed blocks for driver:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


// SIGNUP DRIVER
app.post('/signup-driver', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const userResult = await client.query(
      'INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING user_id',
      [username, password_hash, email]
    );
    const user_id = userResult.rows[0].user_id;

    const driverResult = await client.query(
      `INSERT INTO drivers 
        (user_id, first_name, last_name, phone_number, email, license_number, license_expiration, birth_date, registration_expiration_date, status) 
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
