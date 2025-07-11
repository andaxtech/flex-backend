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