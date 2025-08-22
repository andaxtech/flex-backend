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

// Dashboard endpoint
exports.getDriverDashboard = async (req, res) => {
  try {
    const { driver_id } = req.params;
    
    // Get driver info and level
    const driverQuery = `
      SELECT 
        d.driver_id,
        d.first_name,
        d.last_name,
        d.profile_photo_gcs_path,
        dl.total_points,
        dl.level_name,
        dl.level_number
      FROM drivers d
      LEFT JOIN driver_levels dl ON d.driver_id = dl.driver_id
      WHERE d.driver_id = $1
    `;
    
    const driverResult = await pool.query(driverQuery, [driver_id]);
    if (driverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const driver = driverResult.rows[0];
    
    // Calculate XP progress to next level
    const levelThresholds = [0, 1000, 2000, 4000, 7000, 10000];
    const currentThreshold = levelThresholds[driver.level_number - 1] || 0;
    const nextThreshold = levelThresholds[driver.level_number] || 10000;
    const xpInCurrentLevel = driver.total_points - currentThreshold;
    const xpNeededForLevel = nextThreshold - currentThreshold;
    const xpPercent = Math.round((xpInCurrentLevel / xpNeededForLevel) * 100);
    
    // Get badges
    const badgesQuery = `
      SELECT 
        bd.badge_key,
        bd.badge_name as label,
        bd.badge_icon_url as icon,
        CASE WHEN db.id IS NOT NULL THEN true ELSE false END as earned
      FROM badge_definitions bd
      LEFT JOIN driver_badges db ON bd.badge_key = db.badge_key AND db.driver_id = $1
      WHERE bd.is_active = true
      ORDER BY earned DESC, bd.badge_key
    `;
    
    const badgesResult = await pool.query(badgesQuery, [driver_id]);
    
    // Get weekly leaderboard for driver's market
    const leaderboardQuery = `
      SELECT 
        driver_id,
        full_name as name,
        weekly_points as weeklyXp,
        market_rank
      FROM weekly_leaderboard
      WHERE market = (SELECT city FROM drivers WHERE driver_id = $1)
      ORDER BY market_rank
      LIMIT 10
    `;
    
    const leaderboardResult = await pool.query(leaderboardQuery, [driver_id]);
    
    // Get current streak (simplified for now)
    const streakQuery = `
      SELECT COUNT(DISTINCT DATE(check_in_time)) as streak_days
      FROM block_claims
      WHERE driver_id = $1
        AND status = 'completed'
        AND check_in_time >= CURRENT_DATE - INTERVAL '30 days'
    `;
    
    const streakResult = await pool.query(streakQuery, [driver_id]);
    
    // Get driver stats
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT bc.block_id) as blocks_completed,
        COALESCE(
          ROUND(
            COUNT(DISTINCT CASE WHEN dl.delivery_completed_at - dl.delivery_started_at <= INTERVAL '30 minutes' THEN dl.delivery_id END) * 100.0 / 
            NULLIF(COUNT(DISTINCT dl.delivery_id), 0)
          ), 
          100
        ) as on_time_rate
      FROM drivers d
      LEFT JOIN block_claims bc ON d.driver_id = bc.driver_id AND bc.status = 'completed'
      LEFT JOIN delivery_logs dl ON d.driver_id = dl.driver_id
      WHERE d.driver_id = $1
    `;
    
    const statsResult = await pool.query(statsQuery, [driver_id]);
    const stats = statsResult.rows[0];
    
    res.json({
      name: driver.first_name,
      level: driver.level_number || 1,
      levelName: driver.level_name || 'Rookie Rider',
      xp: driver.total_points || 0,
      xpPercent: xpPercent || 0,
      xpToNextLevel: nextThreshold - (driver.total_points || 0),
      currentStreak: streakResult.rows[0].streak_days || 0,
      blocksCompleted: parseInt(stats.blocks_completed) || 0,
      onTimeRate: parseInt(stats.on_time_rate) || 100,
      badges: badgesResult.rows.map(b => ({
        key: b.badge_key,
        label: b.label,
        icon: { uri: b.icon || 'https://via.placeholder.com/60' },
        earned: b.earned
      })),
      leaderboard: leaderboardResult.rows.map(l => ({
        id: l.driver_id,
        name: l.name,
        avatar: { uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(l.name)}&size=128` },
        weeklyXp: l.weeklyXp || 0
      }))
    });
    
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
}; // THIS CLOSING BRACE WAS MISSING!