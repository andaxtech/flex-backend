// FLEX-BACKEND/controllers/driverController.js
const pool = require('../db');

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
        reference_face_photo_gcs_path,    
        profile_photo_gcs_path,           
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
      profile_image: driver.profile_photo_gcs_path || driver.reference_face_photo_gcs_path || '',
      profileImage: driver.profile_photo_gcs_path || driver.reference_face_photo_gcs_path || '', 
      status: driver.status
    });
  } catch (error) {
    console.error('Error fetching driver:', error);
    res.status(500).json({ error: 'Failed to fetch driver' });
  }
};

// Get driver by user_id (for authenticated drivers)
exports.getDriverByUserId = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    const query = `
      SELECT 
        d.driver_id,
        d.first_name,
        d.last_name,
        d.phone_number,
        d.email,
        d.profile_photo_gcs_path,
        d.reference_face_photo_gcs_path,
        d.status,
        d.city,
        d.zip_code,
        u.clerk_user_id
      FROM drivers d
      INNER JOIN users u ON d.user_id = u.user_id
      WHERE d.user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const driver = result.rows[0];
    res.json({
      driver_id: driver.driver_id,
      name: `${driver.first_name} ${driver.last_name}`,
      first_name: driver.first_name,
      last_name: driver.last_name,
      phone: driver.phone_number,
      email: driver.email,
      profile_image: driver.profile_photo_gcs_path || driver.reference_face_photo_gcs_path || '',
      status: driver.status,
      city: driver.city,
      zip_code: driver.zip_code,
      clerk_user_id: driver.clerk_user_id
    });
  } catch (error) {
    console.error('Error fetching driver by user_id:', error);
    res.status(500).json({ error: 'Failed to fetch driver' });
  }
};

// Get driver by Clerk ID (for Clerk authentication)
exports.getDriverByClerkId = async (req, res) => {
  try {
    const clerkUserId = req.params.clerkId;
    
    const query = `
      SELECT 
        d.driver_id,
        d.first_name,
        d.last_name,
        d.phone_number,
        d.email,
        d.profile_photo_gcs_path,         
    d.reference_face_photo_gcs_path,  
        d.status,
        d.city,
        d.zip_code,
        u.user_id,
        u.role
      FROM users u
      INNER JOIN drivers d ON u.user_id = d.user_id
      WHERE u.clerk_user_id = $1
    `;
    
    const result = await pool.query(query, [clerkUserId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const driver = result.rows[0];
    res.json({
      driver_id: driver.driver_id,
      user_id: driver.user_id,
      name: `${driver.first_name} ${driver.last_name}`,
      first_name: driver.first_name,
      last_name: driver.last_name,
      phone: driver.phone_number,
      email: driver.email,
      profile_image: driver.profile_photo_gcs_path || driver.reference_face_photo_gcs_path || '',
      status: driver.status,
      city: driver.city,
      zip_code: driver.zip_code,
      role: driver.role
    });
  } catch (error) {
    console.error('Error fetching driver by Clerk ID:', error);
    res.status(500).json({ error: 'Failed to fetch driver' });
  }
};

// Update driver status
exports.updateDriverStatus = async (req, res) => {
  const client = await pool.connect();
  try {
    const driverId = parseInt(req.params.id);
    const { status } = req.body;
    
    const validStatuses = ['pending', 'pending_review', 'active', 'inactive', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await client.query('BEGIN');
    
    // Update driver status
    await client.query(
      'UPDATE drivers SET status = $1, updated_at = NOW() WHERE driver_id = $2',
      [status, driverId]
    );
    
    // If driver is approved, update user status too
    if (status === 'active') {
      await client.query(
        `UPDATE users SET status = 'active' 
         WHERE user_id = (SELECT user_id FROM drivers WHERE driver_id = $1)`,
        [driverId]
      );
    }
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: `Driver status updated to ${status}` 
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating driver status:', error);
    res.status(500).json({ error: 'Failed to update driver status' });
  } finally {
    client.release();
  }
};

// Get driver's car details
exports.getDriverCarDetails = async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    
    const query = `
      SELECT 
        car_id,
        car_make,
        car_model,
        car_year,
        car_color,
        vin_number,
        license_plate,
        vehicle_registration_expiration,
        inspection_status
      FROM car_details 
      WHERE driver_id = $1
    `;
    
    const result = await pool.query(query, [driverId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Car details not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching car details:', error);
    res.status(500).json({ error: 'Failed to fetch car details' });
  }
};

// Get driver's insurance details
exports.getDriverInsuranceDetails = async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    
    const query = `
      SELECT 
        insurance_id,
        insurance_provider,
        insurance_policy_number,
        policy_start_date,
        policy_end_date,
        insurance_verification_issues,
        insurance_explanation
      FROM insurance_details 
      WHERE driver_id = $1
    `;
    
    const result = await pool.query(query, [driverId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Insurance details not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching insurance details:', error);
    res.status(500).json({ error: 'Failed to fetch insurance details' });
  }
};

exports.getNextBlock = async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    const storeId = parseInt(req.query.store_id);
    
    console.log(`Looking for next block for driver ${driverId} at store ${storeId}`);
    
    // Get the next claimed block for this driver at the same store
    const query = `
      SELECT 
        b.block_id,
        b.start_time,
        b.end_time,
        b.amount,
        l.city,
        l.region,
        l.time_zone_code,
        l.store_id,
        l.street_name,
        l.phone
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
        address: block.street_name,
        phone: block.phone || '555-0123',
        timeZoneCode: block.time_zone_code
      }
    });
  } catch (error) {
    console.error('Error fetching next block:', error);
    res.status(500).json({ error: 'Failed to fetch next block' });
  }
};