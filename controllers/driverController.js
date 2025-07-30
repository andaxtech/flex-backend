// FLEX-BACKEND/controllers/driverController.js
const pool = require('../db');
const bcrypt = require('bcrypt');

exports.getDrivers = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM drivers WHERE status = $1', ['active']);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getDriverById = async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    
    const query = `
      SELECT 
        driver_id,
        CONCAT(first_name, ' ', last_name) as name,
        first_name,
        last_name,
        phone_number,
        email,
        reference_face_photo_url,
        status
      FROM drivers 
      WHERE driver_id = $1
    `;
    
    const result = await pool.query(query, [driverId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const driver = result.rows[0];
    res.json({
      driver_id: driver.driver_id,
      name: driver.name,
      first_name: driver.first_name,
      last_name: driver.last_name,
      phone: driver.phone_number,
      email: driver.email,
      profile_image: driver.reference_face_photo_url || '',
      profileImage: driver.reference_face_photo_url || '', // For compatibility with frontend
      status: driver.status
    });
  } catch (error) {
    console.error('Error fetching driver:', error);
    res.status(500).json({ error: 'Failed to fetch driver' });
  }
};

exports.signupDriver = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      username, password, email, first_name, last_name, phone_number,
      birth_date, license_number, license_expiration,
      car_make, car_model, car_year, car_color, license_plate, vin_number,
      insurance_provider, insurance_policy_number, policy_start_date, policy_end_date,
      account_holder_first_name, account_holder_last_name, bank_name, bank_account_number, routing_number
    } = req.body;

    const password_hash = await bcrypt.hash(password, 10);
    const userRes = await client.query(
      'INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING user_id',
      [username, password_hash, email]
    );
    const user_id = userRes.rows[0].user_id;

    const driverRes = await client.query(
      `INSERT INTO drivers (user_id, first_name, last_name, phone_number, email, license_number, license_expiration, birth_date, registration_expiration_date, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9) RETURNING driver_id`,
      [user_id, first_name, last_name, phone_number, email, license_number, license_expiration, birth_date, 'pending']
    );
    const driver_id = driverRes.rows[0].driver_id;

    await client.query(`INSERT INTO car_details (driver_id, make, model, year, color, license_plate, vin_number) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [driver_id, car_make, car_model, car_year, car_color, license_plate, vin_number]
    );

    await client.query(`INSERT INTO insurance_details (driver_id, provider, policy_number, start_date, end_date) 
      VALUES ($1, $2, $3, $4, $5)`,
      [driver_id, insurance_provider, insurance_policy_number, policy_start_date, policy_end_date]
    );

    await client.query(`INSERT INTO driver_banking_info (driver_id, account_holder_first_name, account_holder_last_name, bank_name, account_number, routing_number) 
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
};
exports.getNextBlock = async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    const storeId = parseInt(req.query.store_id);
    
    console.log(`Looking for next block for driver ${driverId} at store ${storeId}`);
    
    // Get the next claimed block for this driver at the same store - FIXED TABLE NAMES
    const query = `
      SELECT 
        b.block_id,
        b.start_time,
        b.end_time,
        b.amount,
        b.city,
        b.region,
        b.device_timezone_offset as time_zone_code,
        l.store_id,
        l.street_name,
        l.city as store_city,
        l.region as store_region,
        l.postal_code,
        l.phone,
        l.time_zone_code as store_timezone
      FROM blocks b
      INNER JOIN block_claims bc ON b.block_id = bc.block_id
      LEFT JOIN locations l ON b.location_id = l.location_id
      WHERE bc.driver_id = $1 
        AND l.store_id = $2
        AND b.start_time > NOW()
        AND bc.status = 'accepted'
      ORDER BY b.start_time ASC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [driverId, storeId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No next block found' });
    }
    
    const block = result.rows[0];
    res.json({
      block_id: block.block_id,
      startTime: block.start_time,
      endTime: block.end_time,
      amount: block.amount,
      city: block.city,
      region: block.region,
      store: {
        storeId: block.store_id,
        address: `${block.street_name}, ${block.store_city}, ${block.store_region} ${block.postal_code}`,
        phone: block.phone || '555-0123',
        timeZoneCode: block.store_timezone || block.time_zone_code
      }
    });
  } catch (error) {
    console.error('Error fetching next block:', error);
    res.status(500).json({ error: 'Failed to fetch next block' });
  }
};