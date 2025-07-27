// FLEX-BACKEND/controllers/blockController.js
const pool = require('../db');

// Helper function to parse timezone offset
const fixedOffsetToMinutes = (offsetStr) => {
  const match = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const mins = parseInt(match[3], 10);
  return sign * (hours * 60 + mins);
};

// Helper function to get store timezone day boundaries in UTC
const getStoreDayBoundariesUTC = (utcTimestamp, storeTimezoneCode) => {
  try {
    const offsetMinutes = fixedOffsetToMinutes(storeTimezoneCode);
    
    // Convert UTC timestamp to store local time
    const storeLocalTime = new Date(utcTimestamp.getTime() + offsetMinutes * 60000);
    
    // Get start and end of day in store local time
    const storeStartOfDay = new Date(storeLocalTime.getUTCFullYear(), storeLocalTime.getUTCMonth(), storeLocalTime.getUTCDate(), 0, 0, 0, 0);
    const storeEndOfDay = new Date(storeLocalTime.getUTCFullYear(), storeLocalTime.getUTCMonth(), storeLocalTime.getUTCDate(), 23, 59, 59, 999);
    
    // Convert back to UTC for database queries
    const utcStartOfDay = new Date(storeStartOfDay.getTime() - offsetMinutes * 60000);
    const utcEndOfDay = new Date(storeEndOfDay.getTime() - offsetMinutes * 60000);
    
    return { utcStartOfDay, utcEndOfDay };
  } catch (error) {
    console.error('Error calculating store day boundaries:', error);
    // Fallback to UTC day boundaries
    const utcDay = new Date(utcTimestamp);
    return {
      utcStartOfDay: new Date(utcDay.getUTCFullYear(), utcDay.getUTCMonth(), utcDay.getUTCDate(), 0, 0, 0, 0),
      utcEndOfDay: new Date(utcDay.getUTCFullYear(), utcDay.getUTCMonth(), utcDay.getUTCDate(), 23, 59, 59, 999)
    };
  }
};

exports.claimBlock = async (req, res) => {
  const { block_id, driver_id } = req.body;

  if (!block_id || !driver_id) {
    return res.status(400).json({ success: false, message: 'Missing block_id or driver_id' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get block details with store timezone
    const blockRes = await client.query(`
      SELECT 
        b.block_id, 
        b.start_time, 
        b.end_time, 
        b.location_id,
        b.status,
        l.time_zone_code,
        l.store_id
      FROM blocks b
      INNER JOIN locations l ON b.location_id = l.location_id
      WHERE b.block_id = $1
    `, [block_id]);

    if (blockRes.rowCount === 0) {
      throw new Error('Block not found');
    }

    const block = blockRes.rows[0];
    const { start_time, end_time, time_zone_code } = block;

    // Validate block is still available
    if (block.status !== 'available') {
      throw new Error('This block is no longer available');
    }

    const newStart = new Date(start_time);
    const newEnd = new Date(end_time);

    // Validate timestamps
    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
      throw new Error('Invalid block timestamps');
    }

    // Check if block has already started (with grace period)
    const now = new Date();
    const gracePeriodEnd = new Date(newStart.getTime() + 5 * 60 * 1000); // 5 minutes after start
    if (now > gracePeriodEnd) {
      throw new Error('Cannot claim block that has already started');
    }

    // Get store timezone day boundaries for overlap checking
    const { utcStartOfDay, utcEndOfDay } = getStoreDayBoundariesUTC(newStart, time_zone_code);

    console.log('Checking overlaps for driver', driver_id, 'on store day:', {
      storeTimezone: time_zone_code,
      utcStartOfDay: utcStartOfDay.toISOString(),
      utcEndOfDay: utcEndOfDay.toISOString(),
      newBlockStart: newStart.toISOString(),
      newBlockEnd: newEnd.toISOString()
    });

    // Check for existing claims on the same store day
    const existingClaims = await client.query(`
      SELECT b.block_id, b.start_time, b.end_time, l.store_id
      FROM block_claims bc 
      JOIN blocks b ON bc.block_id = b.block_id 
      JOIN locations l ON b.location_id = l.location_id
      WHERE bc.driver_id = $1 
        AND bc.status = 'accepted'
        AND b.start_time BETWEEN $2 AND $3
    `, [driver_id, utcStartOfDay, utcEndOfDay]);

    let overlapCount = 0;
    for (const row of existingClaims.rows) {
      const claimedStart = new Date(row.start_time);
      const claimedEnd = new Date(row.end_time);

      // Check for time overlap
      const isOverlap = newStart < claimedEnd && newEnd > claimedStart;
      if (isOverlap) {
        console.log('Found overlapping block:', {
          existingBlock: row.block_id,
          existingStart: claimedStart.toISOString(),
          existingEnd: claimedEnd.toISOString(),
          newStart: newStart.toISOString(),
          newEnd: newEnd.toISOString()
        });
        overlapCount += 1;
      }
    }

    if (overlapCount > 0) {
      throw new Error(`Cannot claim overlapping block. You already have ${overlapCount} overlapping block(s) on this day.`);
    }

    // Check if someone else has already claimed this specific block
    const dupCheck = await client.query(
      'SELECT bc.claim_id, bc.driver_id FROM block_claims bc WHERE bc.block_id = $1 AND bc.status = $2', 
      [block_id, 'accepted']
    );
    
    if (dupCheck.rowCount > 0) {
      throw new Error('This block has already been claimed by another driver');
    }

    // Create the claim
    const claimResult = await client.query(`
      INSERT INTO block_claims (block_id, driver_id, claim_time, status) 
      VALUES ($1, $2, NOW(), $3) 
      RETURNING *
    `, [block_id, driver_id, 'accepted']);

    // Update block status
    await client.query(
      'UPDATE blocks SET status = $1 WHERE block_id = $2', 
      ['accepted', block_id]
    );

    await client.query('COMMIT');
    
    console.log(`Block ${block_id} successfully claimed by driver ${driver_id}`);
    
    res.status(201).json({ 
      success: true, 
      message: 'Block claimed successfully', 
      data: {
        claim_id: claimResult.rows[0].claim_id,
        block_id: block_id,
        claim_time: claimResult.rows[0].claim_time
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Claim error:', err.message);
    res.status(400).json({ 
      success: false, 
      error: err.message 
    });
  } finally {
    client.release();
  }
};



exports.unclaimBlock = async (req, res) => {
  const { block_id, driver_id, override_penalty } = req.body;

  if (!block_id || !driver_id) {
    return res.status(400).json({ success: false, message: 'Missing block_id or driver_id' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get block details with store timezone
    const blockResult = await client.query(`
      SELECT 
        b.block_id,
        b.start_time, 
        b.end_time,
        b.status,
        l.time_zone_code,
        l.store_id
      FROM blocks b
      INNER JOIN locations l ON b.location_id = l.location_id
      WHERE b.block_id = $1
    `, [block_id]);

    if (blockResult.rowCount === 0) {
      throw new Error('Block not found');
    }

    const block = blockResult.rows[0];
    const { start_time, time_zone_code } = block;

    // Validate timestamps
    const startTimeUtc = new Date(start_time);
    if (isNaN(startTimeUtc.getTime())) {
      throw new Error('Invalid block start time');
    }

    // Check if claim exists for this driver
    const claimRes = await client.query(`
      SELECT claim_id, claim_time, status 
      FROM block_claims 
      WHERE block_id = $1 AND driver_id = $2
    `, [block_id, driver_id]);

    if (claimRes.rowCount === 0) {
      throw new Error('No claim found for this block and driver');
    }

    const claim = claimRes.rows[0];
    const claimId = claim.claim_id;

    // Check if claim is still active
    if (claim.status !== 'accepted') {
      throw new Error('Block claim is not in accepted status');
    }

    // Calculate time difference for penalty determination
    const nowUtc = new Date();
    const diffMinutes = (startTimeUtc.getTime() - nowUtc.getTime()) / (1000 * 60);

    console.log('Unclaim timing analysis:', {
      blockId: block_id,
      driverId: driver_id,
      storeTimezone: time_zone_code,
      startTimeUtc: startTimeUtc.toISOString(),
      nowUtc: nowUtc.toISOString(),
      diffMinutes: Math.round(diffMinutes),
      overridePenalty: override_penalty
    });

    // Check if block has already started (with 5-minute grace period)
    const gracePeriodMinutes = 5;
    if (diffMinutes < -gracePeriodMinutes) {
      throw new Error(`Cannot unclaim a block that started more than ${gracePeriodMinutes} minutes ago`);
    }

    // Warning for late unclaims (within 60 minutes of start OR already started but within grace period)
    if (diffMinutes <= 60 && !override_penalty) {
      await client.query('ROLLBACK');
      
      const warningMessage = diffMinutes <= 0 
        ? `Block started ${Math.abs(Math.round(diffMinutes))} minutes ago. Unclaiming now will impact your standing. Confirm to proceed.`
        : `Unclaiming within ${Math.round(diffMinutes)} minutes of start will impact your standing. Confirm to proceed.`;
      
      return res.status(400).json({ 
        success: false,
        warning: true, 
        message: warningMessage,
        details: {
          minutesUntilStart: Math.round(diffMinutes),
          penaltyApplied: true,
          hasStarted: diffMinutes <= 0
        }
      });
    }

    // Apply penalty for late unclaims FIRST (within 60 minutes)
    let penaltyApplied = false;
    if (diffMinutes <= 60) {
      try {
        // Fixed INSERT query without description field
        await client.query(`
          INSERT INTO pizza_points
            (driver_id, event_type, points, event_time, block_id, claim_id)
          VALUES
            ($1, $2, $3, NOW(), $4, $5)
        `, [
          driver_id, 
          'Forfeit within 60', 
          -20, 
          block_id, 
          claimId
        ]);
        penaltyApplied = true;
        console.log(`Applied -20 point penalty to driver ${driver_id} for late unclaim of block ${block_id}`);
      } catch (penaltyError) {
        console.error('Error applying penalty points:', penaltyError);
        // Rollback and fail the entire operation if penalty can't be applied
        await client.query('ROLLBACK');
        return res.status(500).json({ 
          success: false,
          error: 'Failed to apply penalty points. Unclaim cancelled.' 
        });
      }
    }

    // Delete the claim
    const deleteResult = await client.query(
      'DELETE FROM block_claims WHERE block_id = $1 AND driver_id = $2', 
      [block_id, driver_id]
    );

    if (deleteResult.rowCount === 0) {
      throw new Error('Failed to delete claim - it may have been already removed');
    }

    console.log(`Deleted ${deleteResult.rowCount} claim(s) for block ${block_id}, driver ${driver_id}`);

    // Update the block status back to available
    const updateResult = await client.query(
      'UPDATE blocks SET status = $1 WHERE block_id = $2', 
      ['available', block_id]
    );

    console.log(`Updated block ${block_id} status to 'available', affected rows: ${updateResult.rowCount}`);

    // Verify the changes before committing
    const verifyBlock = await client.query(
      'SELECT status FROM blocks WHERE block_id = $1',
      [block_id]
    );
    const verifyClaim = await client.query(
      'SELECT * FROM block_claims WHERE block_id = $1 AND driver_id = $2',
      [block_id, driver_id]
    );

    console.log('Verification before commit:', {
      blockStatus: verifyBlock.rows[0]?.status,
      claimExists: verifyClaim.rowCount > 0,
      claimRows: verifyClaim.rowCount
    });

    // Commit the transaction
    await client.query('COMMIT');
    
    console.log(`✅ Block ${block_id} successfully unclaimed by driver ${driver_id}`, {
      penaltyApplied,
      minutesBeforeStart: Math.round(diffMinutes),
      wasAlreadyStarted: diffMinutes <= 0
    });
    
    res.status(200).json({ 
      success: true,
      message: 'Block unclaimed successfully',
      details: {
        minutesBeforeStart: Math.round(diffMinutes),
        penaltyApplied,
        pointsDeducted: penaltyApplied ? -20 : 0
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Unclaim error:', err.message);
    console.error('Full error:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  } finally {
    client.release();
  }
};
// API to get available blocks - with IANA timezone support
// API to get available blocks - with eligibility check and specific error messages
exports.getAvailableBlocks = async (req, res) => {
  const { driver_id } = req.query;
  const driverIdInt = parseInt(driver_id);

  if (!driver_id || isNaN(driverIdInt)) {
    return res.status(400).json({ success: false, message: 'Missing or invalid driver_id' });
  }

  try {
    // First, check driver eligibility
    const eligibilityQuery = `
      WITH valid_insurance AS (
        SELECT 
          driver_id,
          MAX(end_date) as latest_insurance_end
        FROM insurance_details
        WHERE driver_id = $1
        GROUP BY driver_id
      )
      SELECT 
        d.driver_id,
        d.license_expiration,
        d.registration_expiration_date,
        vi.latest_insurance_end,
        CASE 
          WHEN d.license_expiration <= NOW() THEN 'expired'
          WHEN d.license_expiration <= NOW() + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'valid'
        END as license_status,
        CASE 
          WHEN d.registration_expiration_date <= NOW() THEN 'expired'
          WHEN d.registration_expiration_date <= NOW() + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'valid'
        END as registration_status,
        CASE 
          WHEN vi.latest_insurance_end IS NULL OR vi.latest_insurance_end <= NOW() THEN 'expired'
          WHEN vi.latest_insurance_end <= NOW() + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'valid'
        END as insurance_status
      FROM drivers d
      LEFT JOIN valid_insurance vi ON d.driver_id = vi.driver_id
      WHERE d.driver_id = $1
    `;

    const eligibilityResult = await pool.query(eligibilityQuery, [driverIdInt]);
    
    if (eligibilityResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }

    const driverStatus = eligibilityResult.rows[0];
    const ineligibilityReasons = [];
    const warnings = [];

    // Check for expired credentials
    if (driverStatus.license_status === 'expired') {
      ineligibilityReasons.push({
        type: 'license',
        message: `Your driver's license expired on ${new Date(driverStatus.license_expiration).toLocaleDateString()}`,
        expiredDate: driverStatus.license_expiration
      });
    } else if (driverStatus.license_status === 'expiring_soon') {
      warnings.push({
        type: 'license',
        message: `Your driver's license expires on ${new Date(driverStatus.license_expiration).toLocaleDateString()}`,
        expiryDate: driverStatus.license_expiration
      });
    }

    if (driverStatus.registration_status === 'expired') {
      ineligibilityReasons.push({
        type: 'registration',
        message: `Your vehicle registration expired on ${new Date(driverStatus.registration_expiration_date).toLocaleDateString()}`,
        expiredDate: driverStatus.registration_expiration_date
      });
    } else if (driverStatus.registration_status === 'expiring_soon') {
      warnings.push({
        type: 'registration',
        message: `Your vehicle registration expires on ${new Date(driverStatus.registration_expiration_date).toLocaleDateString()}`,
        expiryDate: driverStatus.registration_expiration_date
      });
    }

    if (driverStatus.insurance_status === 'expired') {
      ineligibilityReasons.push({
        type: 'insurance',
        message: driverStatus.latest_insurance_end 
          ? `Your insurance expired on ${new Date(driverStatus.latest_insurance_end).toLocaleDateString()}`
          : 'No valid insurance on file',
        expiredDate: driverStatus.latest_insurance_end
      });
    } else if (driverStatus.insurance_status === 'expiring_soon' && driverStatus.latest_insurance_end) {
      warnings.push({
        type: 'insurance',
        message: `Your insurance expires on ${new Date(driverStatus.latest_insurance_end).toLocaleDateString()}`,
        expiryDate: driverStatus.latest_insurance_end
      });
    }

    // If driver is ineligible, return specific error message
    if (ineligibilityReasons.length > 0) {
      return res.json({
        success: false,
        eligible: false,
        ineligibilityReasons,
        warnings,
        message: 'You are not eligible to view blocks due to expired credentials. Please update your records to participate.',
        blocks: [],
        blocksByDate: { 'all': [] }
      });
    }

    // If eligible, proceed with fetching blocks
    const blocksQuery = `
      WITH latest_claims AS (
        SELECT * FROM (
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
        b.device_time_zone_name,
        b.device_timezone_offset,
        lc.claim_id,
        l.store_id,
        l.street_name,
        l.city,
        l.region,
        l.phone,
        l.postal_code,
        l.store_latitude,
        l.store_longitude,
        l.time_zone_code
      FROM blocks AS b
      LEFT JOIN latest_claims lc ON b.block_id = lc.block_id
      INNER JOIN locations l ON b.location_id = l.location_id
      WHERE b.status = 'available'
        AND lc.claim_id IS NULL
        AND b.start_time > NOW()
      ORDER BY b.start_time
    `;

    const result = await pool.query(blocksQuery);
    const blocksList = [];
    
    result.rows.forEach((row) => {
      try {
        if (!row.start_time || !row.end_time) {
          console.warn('Block missing time data:', row.block_id);
          return;
        }
        
        const startTimeISO = row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time;
        const endTimeISO = row.end_time instanceof Date ? row.end_time.toISOString() : row.end_time;
        
        let blockTimezoneOffset = row.device_timezone_offset || row.time_zone_code;
        
        if (blockTimezoneOffset && !blockTimezoneOffset.startsWith('GMT')) {
          blockTimezoneOffset = `GMT${blockTimezoneOffset}`;
        }
        
        const timeZoneName = row.device_time_zone_name || null;
        
        blocksList.push({
          block_id: row.block_id,
          startTime: startTimeISO,
          endTime: endTimeISO,
          amount: row.amount,
          locationId: row.location_id,
          city: row.city,
          region: row.region,
          timeZoneCode: blockTimezoneOffset,
          timeZoneName: timeZoneName,
          store: {
            storeId: row.store_id,
            address: `${row.street_name}, ${row.city}, ${row.region} ${row.postal_code}`,
            phone: row.phone,
            latitude: row.store_latitude,
            longitude: row.store_longitude,
            timeZoneCode: row.time_zone_code,
            timeZoneName: timeZoneName
          }
        });
      } catch (error) {
        console.error('Error processing block row:', error, row);
      }
    });

    console.log(`Returning ${blocksList.length} available blocks for driver ${driverIdInt}`);
    
    res.json({ 
      success: true,
      eligible: true,
      warnings, // Include any expiring soon warnings
      blocksByDate: { 'all': blocksList },
      blocks: blocksList
    });
  } catch (err) {
    console.error('❌ Error fetching available blocks for driver:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


// Get claimed blocks API - with IANA timezone support
exports.getClaimedBlocks = async (req, res) => {
  const { driver_id } = req.query;
  const driverIdInt = parseInt(driver_id);

  if (!driver_id || isNaN(driverIdInt)) {
    return res.status(400).json({ success: false, message: 'Missing or invalid driver_id' });
  }

  try {
    const query = `
      WITH latest_claims AS (
        SELECT * FROM (
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
        b.device_time_zone_name,  -- IANA timezone from blocks table
        b.device_timezone_offset, -- Device offset from blocks table
        lc.claim_time,
        l.store_id,
        l.street_name,
        l.city,
        l.region,
        l.phone,
        l.postal_code,
        l.store_latitude,
        l.store_longitude,
        l.time_zone_code,         -- Store's fixed offset
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'managerId', m.manager_id,
              'firstName', m.first_name
            )
          ) FILTER (WHERE m.manager_id IS NOT NULL),
          '[]'
        ) AS managers
      FROM latest_claims lc
      INNER JOIN blocks b ON lc.block_id = b.block_id
      INNER JOIN locations l ON b.location_id = l.location_id
      LEFT JOIN manager_store_links msl ON l.store_id = msl.store_id
      LEFT JOIN managers m ON msl.manager_id = m.manager_id
      GROUP BY
       b.block_id, b.date, b.start_time, b.end_time, b.amount, b.status,
       b.location_id, b.device_time_zone_name, b.device_timezone_offset,
       lc.claim_time,
       l.store_id, l.street_name, l.city, l.region, l.phone, l.postal_code,
       l.store_latitude, l.store_longitude, l.time_zone_code
      ORDER BY b.start_time
    `;

    const result = await pool.query(query, [driverIdInt]);
    const blocksList = [];
    
    result.rows.forEach((row) => {
      try {
        // Validate timestamps
        const startTimeISO = row.start_time?.toISOString() || null;
        const endTimeISO = row.end_time?.toISOString() || null;
        const claimTimeISO = row.claim_time?.toISOString() || null;
        
        if (!startTimeISO || !endTimeISO) {
          console.warn('Block missing time data:', row.block_id);
          return;
        }
        
        // Use IANA timezone if available
        const timeZoneName = row.device_time_zone_name || null;
        const timeZoneOffset = row.device_timezone_offset || row.time_zone_code;
        
        blocksList.push({
          block_id: row.block_id,
          startTime: startTimeISO,
          endTime: endTimeISO,
          amount: row.amount,
          status: row.status,
          claimTime: claimTimeISO,
          locationId: row.location_id,
          city: row.city,
          region: row.region,
          timeZoneCode: timeZoneOffset,     // For backward compatibility
          timeZoneName: timeZoneName,       // IANA timezone
          store: {
            storeId: row.store_id,
            address: `${row.street_name}, ${row.city}, ${row.region} ${row.postal_code}`,
            phone: row.phone,
            latitude: row.store_latitude,
            longitude: row.store_longitude,
            timeZoneCode: row.time_zone_code,    // Store's fixed offset
            timeZoneName: timeZoneName            // IANA timezone from block creation
          },
          managers: row.managers
        });
      } catch (error) {
        console.error('Error processing claimed block row:', error, row);
      }
    });

    // Group by date using IANA timezone for accurate grouping
    const grouped = {};
    
    blocksList.forEach(block => {
      try {
        let dateKey;
        
        // Use IANA timezone for accurate date grouping if available
        if (block.timeZoneName) {
          const startDate = new Date(block.startTime);
          // This formats the date in the block's timezone
          dateKey = startDate.toLocaleDateString('en-CA', { 
            timeZone: block.timeZoneName,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
        } else {
          // Fallback to UTC date if no timezone info
          dateKey = block.startTime.split('T')[0];
        }
        
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(block);
      } catch (error) {
        console.error('Error grouping block by date:', error, block);
      }
    });

    // Sort dates
    const sortedGrouped = {};
    Object.keys(grouped).sort().forEach(date => {
      sortedGrouped[date] = grouped[date];
    });

    console.log(`Returning ${Object.keys(sortedGrouped).length} dates with claimed blocks for driver ${driverIdInt}`);
    
    res.json({ 
      success: true, 
      blocksByDate: sortedGrouped,
      claimedBlocks: blocksList  // Also send flat array
    });
  } catch (err) {
    console.error('❌ Error fetching claimed blocks for driver:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update expired blocks function
exports.updateExpiredBlocks = async (req, res) => {
  try {
    const { blockIds, status } = req.body;

    // Validate input
    if (!blockIds || !Array.isArray(blockIds) || blockIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'blockIds must be a non-empty array'
      });
    }

    if (!status || status !== 'expired') {
      return res.status(400).json({
        success: false,
        error: 'status must be "expired"'
      });
    }

    console.log(`🕒 Updating ${blockIds.length} blocks to expired status:`, blockIds);

    // Create PostgreSQL query with proper parameter placeholders
    const placeholders = blockIds.map((_, index) => `$${index + 2}`).join(',');
    const updateQuery = `
      UPDATE blocks 
      SET status = $1 
      WHERE block_id IN (${placeholders})
      AND status != 'expired'
    `;

    const queryParams = [status, ...blockIds];
    
    // Execute the query using your existing pool connection
    const result = await pool.query(updateQuery, queryParams);
    
    const updatedCount = result.rowCount || 0;
    console.log(`✅ Successfully updated ${updatedCount} blocks to expired status`);

    res.json({
      success: true,
      updatedCount: updatedCount,
      message: `Successfully marked ${updatedCount} blocks as expired`
    });

  } catch (error) {
    console.error('❌ Error updating expired blocks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update expired blocks',
      details: error.message
    });
  }
};
