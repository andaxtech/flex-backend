
//Add GCS download functionality
const { Storage } = require('@google-cloud/storage');

// Delay initialization until first use
let storage = null;
let bucketName = null;
let storageInitialized = false;

// Initialize storage on first use
function initializeStorage() {
  if (storageInitialized) return;
  
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      // Parse the JSON string from Railway environment variable
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      storage = new Storage({
        projectId: process.env.GCS_PROJECT_ID,
        credentials: credentials
      });
      console.log('✅ GCS initialized with Railway JSON credentials');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Fallback to file path for local development
      storage = new Storage({
        projectId: process.env.GCS_PROJECT_ID,
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
      });
      console.log('✅ GCS initialized with local file credentials');
    } else {
      throw new Error('No GCS credentials configured (neither GOOGLE_APPLICATION_CREDENTIALS_JSON nor GOOGLE_APPLICATION_CREDENTIALS)');
    }
    
    bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('GCS_BUCKET_NAME not configured');
    }
    
    storageInitialized = true;
  } catch (error) {
    console.error('❌ Failed to initialize GCS:', error.message);
    throw error;
  }
}

async function getGCSImageUrl(gcsPath) {
  try {
    // Initialize storage on first use
    if (!storageInitialized) {
      initializeStorage();
    }
    
    const file = storage.bucket(bucketName).file(gcsPath);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });
    return url;
  } catch (error) {
    console.error('Error getting GCS signed URL:', error);
    throw new Error('Failed to retrieve reference photo');
  }
}

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

// Add these imports at the top of blockController.js
const { cloudinary, upload } = require('../config/cloudinary');
const axios = require('axios'); // for face verification API calls


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


// API for claiming blocks
exports.claimBlock = async (req, res) => {
  const { block_id, driver_id } = req.body;

  if (!block_id || !driver_id) {
    return res.status(400).json({ success: false, message: 'Missing block_id or driver_id' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // UPDATED QUERY: Include manager_id
    const blockRes = await client.query(`
      SELECT 
        b.block_id, 
        b.start_time, 
        b.end_time, 
        b.location_id,
        b.status,
        b.manager_id,  -- ADD: Include manager_id
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
    const { start_time, end_time, time_zone_code, manager_id } = block;

    // Rest of the validation logic remains the same...
    if (block.status !== 'available') {
      throw new Error('This block is no longer available');
    }

    const newStart = new Date(start_time);
    const newEnd = new Date(end_time);

    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
      throw new Error('Invalid block timestamps');
    }

    const now = new Date();
    const gracePeriodEnd = new Date(newStart.getTime() + 5 * 60 * 1000);
    if (now > gracePeriodEnd) {
      throw new Error('Cannot claim block that has already started');
    }

    const { utcStartOfDay, utcEndOfDay } = getStoreDayBoundariesUTC(newStart, time_zone_code);

    console.log('Checking overlaps for driver', driver_id, 'on store day:', {
      storeTimezone: time_zone_code,
      utcStartOfDay: utcStartOfDay.toISOString(),
      utcEndOfDay: utcEndOfDay.toISOString(),
      newBlockStart: newStart.toISOString(),
      newBlockEnd: newEnd.toISOString(),
      blockManagerId: manager_id  // ADD: Log manager_id
    });

    // Check for existing claims (unchanged)
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

    await client.query(
      'UPDATE blocks SET status = $1 WHERE block_id = $2', 
      ['accepted', block_id]
    );

    await client.query('COMMIT');
    
    console.log(`Block ${block_id} (created by manager ${manager_id}) successfully claimed by driver ${driver_id}`);
    
    // WEBSOCKET: Emit block claimed event
    if (global.socketIO && global.socketIO.emitBlockClaimed) {
      global.socketIO.emitBlockClaimed(block_id, driver_id);
      console.log(`🔌 Emitted block-claimed event for block ${block_id}`);
    }

    // WEBSOCKET: Emit schedule update for the driver who claimed
if (global.socketIO && global.socketIO.emitScheduleUpdated) {
  global.socketIO.emitScheduleUpdated(driver_id, block_id, { action: 'claimed' });
  console.log(`🔌 Emitted schedule-updated event for driver ${driver_id}`);
}
    
    res.status(201).json({ 
      success: true, 
      message: 'Block claimed successfully', 
      data: {
        claim_id: claimResult.rows[0].claim_id,
        block_id: block_id,
        claim_time: claimResult.rows[0].claim_time,
        manager_id: manager_id
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




//API for unclaiming a blocl
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
    
    // WEBSOCKET: Emit block released event
    if (global.socketIO && global.socketIO.emitBlockReleased) {
      global.socketIO.emitBlockReleased(block_id);
      console.log(`🔌 Emitted block-released event for block ${block_id}`);
    }

    // WEBSOCKET: Emit schedule-specific event for the driver who unclaimed
if (global.socketIO && global.socketIO.emitBlockCancelled) {
  global.socketIO.emitBlockCancelled(driver_id, block_id, 'Driver unclaimed block');
  console.log(`🔌 Emitted block-cancelled event for driver ${driver_id}`);
}
    
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




/// API to get available blocks - with IANA timezone support
// API to get available blocks - with eligibility check and specific error messages
// 1. UPDATE: getAvailableBlocks - Include manager info in the response
exports.getAvailableBlocks = async (req, res) => {
  const { driver_id } = req.query;
  const driverIdInt = parseInt(driver_id);

  if (!driver_id || isNaN(driverIdInt)) {
    return res.status(400).json({ success: false, message: 'Missing or invalid driver_id' });
  }

  try {
// First, check driver eligibility (UPDATED to use car_details table)

    const eligibilityQuery = `
      WITH valid_insurance AS (
  SELECT 
    driver_id,
    MAX(policy_end_date) as latest_insurance_end
  FROM insurance_details
  WHERE driver_id = $1
  GROUP BY driver_id
)
      SELECT 
        d.driver_id,
        d.driver_license_expiration,
        cd.vehicle_registration_expiration,
        vi.latest_insurance_end,
        CASE 
          WHEN d.driver_license_expiration <= NOW() THEN 'expired'
          WHEN d.driver_license_expiration <= NOW() + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'valid'
        END as license_status,
        CASE 
          WHEN cd.vehicle_registration_expiration <= NOW() THEN 'expired'
          WHEN cd.vehicle_registration_expiration <= NOW() + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'valid'
        END as registration_status,
        CASE 
          WHEN vi.latest_insurance_end IS NULL OR vi.latest_insurance_end <= NOW() THEN 'expired'
          WHEN vi.latest_insurance_end <= NOW() + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'valid'
        END as insurance_status
      FROM drivers d
      LEFT JOIN car_details cd ON d.driver_id = cd.driver_id
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

    // Check for expired credentials (UPDATED to use correct column names)
    if (driverStatus.license_status === 'expired') {
      ineligibilityReasons.push({
        type: 'license',
        message: `Your driver's license expired on ${new Date(driverStatus.driver_license_expiration).toLocaleDateString()}`,
        expiredDate: driverStatus.driver_license_expiration
      });
    } else if (driverStatus.license_status === 'expiring_soon') {
      warnings.push({
        type: 'license',
        message: `Your driver's license expires on ${new Date(driverStatus.driver_license_expiration).toLocaleDateString()}`,
        expiryDate: driverStatus.driver_license_expiration
      });
    }

    if (driverStatus.registration_status === 'expired') {
      ineligibilityReasons.push({
        type: 'registration',
        message: `Your vehicle registration expired on ${new Date(driverStatus.vehicle_registration_expiration).toLocaleDateString()}`,
        expiredDate: driverStatus.vehicle_registration_expiration
      });
    } else if (driverStatus.registration_status === 'expiring_soon') {
      warnings.push({
        type: 'registration',
        message: `Your vehicle registration expires on ${new Date(driverStatus.vehicle_registration_expiration).toLocaleDateString()}`,
        expiryDate: driverStatus.vehicle_registration_expiration
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

    // UPDATED QUERY: Include manager information in blocks query
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
        b.manager_id,  -- ADD: Include manager_id from blocks table
        lc.claim_id,
        l.store_id,
        l.street_name,
        l.city,
        l.region,
        l.phone,
        l.postal_code,
        l.store_latitude,
        l.store_longitude,
        l.time_zone_code,
        m.first_name as manager_first_name,  -- ADD: Manager details
        m.last_name as manager_last_name,
        m.phone_number as manager_phone
      FROM blocks AS b
      LEFT JOIN latest_claims lc ON b.block_id = lc.block_id
      INNER JOIN locations l ON b.location_id = l.location_id
      LEFT JOIN managers m ON b.manager_id = m.manager_id  -- ADD: Join with managers table
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
          manager_id: row.manager_id,  // ADD: Include manager_id
          manager: row.manager_id ? {  // ADD: Manager info object
            id: row.manager_id,
            name: `${row.manager_first_name || ''} ${row.manager_last_name || ''}`.trim(),
            phone: row.manager_phone
          } : null,
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
      warnings,
      blocksByDate: { 'all': blocksList },
      blocks: blocksList
    });
  } catch (err) {
    console.error('❌ Error fetching available blocks for driver:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};



// Get claimed blocks API - with IANA timezone support and claim_id
// 2. UPDATE: getClaimedBlocks - Include manager info for claimed blocks
exports.getClaimedBlocks = async (req, res) => {
  const { driver_id } = req.query;
  const driverIdInt = parseInt(driver_id);

  if (!driver_id || isNaN(driverIdInt)) {
    return res.status(400).json({ success: false, message: 'Missing or invalid driver_id' });
  }

  try {
    // UPDATED QUERY: Include manager information
    const query = `
      WITH latest_claims AS (
        SELECT * FROM (
          SELECT claim_id, block_id, driver_id, claim_time, service_status,
                 ROW_NUMBER() OVER (PARTITION BY block_id ORDER BY claim_time DESC) AS rn
          FROM block_claims
          WHERE driver_id = $1
        ) sub
        WHERE rn = 1
      )
      SELECT
        b.block_id,
        lc.claim_id,
        b.date,
        b.start_time,
        b.end_time,
        b.amount,
        b.status,
        b.location_id,
        b.device_time_zone_name,
        b.device_timezone_offset,
        b.manager_id,  -- ADD: Include manager_id
        lc.claim_time,
        lc.service_status,
        l.store_id,
        l.street_name,
        l.city,
        l.region,
        l.phone,
        l.postal_code,
        l.store_latitude,
        l.store_longitude,
        l.time_zone_code,
        m.first_name as block_manager_first_name,  -- ADD: Manager who created the block
        m.last_name as block_manager_last_name,
        m.phone_number as block_manager_phone,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'managerId', sm.manager_id,
              'firstName', sm.first_name,
              'lastName', sm.last_name,  -- ADD: Include last name
              'phone', sm.phone_number   -- ADD: Include phone
            )
          ) FILTER (WHERE sm.manager_id IS NOT NULL),
          '[]'
        ) AS store_managers  -- Changed from 'managers' to 'store_managers' for clarity
      FROM latest_claims lc
      INNER JOIN blocks b ON lc.block_id = b.block_id
      INNER JOIN locations l ON b.location_id = l.location_id
      LEFT JOIN managers m ON b.manager_id = m.manager_id  -- ADD: Join for block creator
      LEFT JOIN manager_store_links msl ON l.store_id = msl.store_id
      LEFT JOIN managers sm ON msl.manager_id = sm.manager_id  -- Store managers
      GROUP BY
       b.block_id, b.date, b.start_time, b.end_time, b.amount, b.status,
       b.location_id, b.device_time_zone_name, b.device_timezone_offset,
       b.manager_id,  -- ADD: Include in GROUP BY
       lc.claim_id, lc.claim_time, lc.service_status,
       l.store_id, l.street_name, l.city, l.region, l.phone, l.postal_code,
       l.store_latitude, l.store_longitude, l.time_zone_code,
       m.first_name, m.last_name, m.phone_number  -- ADD: Manager fields to GROUP BY
      ORDER BY b.start_time
    `;

    const result = await pool.query(query, [driverIdInt]);
    const blocksList = [];
    
    result.rows.forEach((row) => {
      try {
        const startTimeISO = row.start_time?.toISOString() || null;
        const endTimeISO = row.end_time?.toISOString() || null;
        const claimTimeISO = row.claim_time?.toISOString() || null;
        
        if (!startTimeISO || !endTimeISO) {
          console.warn('Block missing time data:', row.block_id);
          return;
        }
        
        const timeZoneName = row.device_time_zone_name || null;
        const timeZoneOffset = row.device_timezone_offset || row.time_zone_code;
        
        blocksList.push({
          block_id: row.block_id,
          claim_id: row.claim_id,
          claimId: row.claim_id,
          startTime: startTimeISO,
          endTime: endTimeISO,
          amount: row.amount,
          status: row.status,
          service_status: row.service_status || 'accepted',
          claimTime: claimTimeISO,
          locationId: row.location_id,
          city: row.city,
          region: row.region,
          timeZoneCode: timeZoneOffset,
          timeZoneName: timeZoneName,
          manager_id: row.manager_id,  // ADD: Block creator's manager_id
          blockCreator: row.manager_id ? {  // ADD: Info about who created the block
            id: row.manager_id,
            name: `${row.block_manager_first_name || ''} ${row.block_manager_last_name || ''}`.trim(),
            phone: row.block_manager_phone
          } : null,
          store: {
            storeId: row.store_id,
            address: `${row.street_name}, ${row.city}, ${row.region} ${row.postal_code}`,
            phone: row.phone,
            latitude: row.store_latitude,
            longitude: row.store_longitude,
            timeZoneCode: row.time_zone_code,
            timeZoneName: timeZoneName
          },
          storeManagers: row.store_managers  // Renamed for clarity
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
        
        if (block.timeZoneName) {
          const startDate = new Date(block.startTime);
          dateKey = startDate.toLocaleDateString('en-CA', { 
            timeZone: block.timeZoneName,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
        } else {
          dateKey = block.startTime.split('T')[0];
        }
        
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(block);
      } catch (error) {
        console.error('Error grouping block by date:', error, block);
      }
    });

    const sortedGrouped = {};
    Object.keys(grouped).sort().forEach(date => {
      sortedGrouped[date] = grouped[date];
    });

    console.log(`Returning ${Object.keys(sortedGrouped).length} dates with claimed blocks for driver ${driverIdInt}`);
    console.log(`Total blocks: ${blocksList.length}, Sample block:`, blocksList[0] ? {
      block_id: blocksList[0].block_id,
      claim_id: blocksList[0].claim_id,
      service_status: blocksList[0].service_status,
      manager_id: blocksList[0].manager_id
    } : 'No blocks');
    
    res.json({ 
      success: true, 
      blocksByDate: sortedGrouped,
      claimedBlocks: blocksList
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




// Face comparison function (you'll need to implement with your chosen service)
const OpenAI = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Face comparison function using OpenAI Vision API
async function compareFaces(referencePhotoUrl, checkInPhotoUrl, checkLiveness = true) {
  try {
    console.log('🔍 Starting face comparison with OpenAI Vision API...');
    
    const messages = [
      {
        role: "system",
        content: "You are a face verification system. Compare faces and detect if photos are real (not photos of photos/screens). Return JSON only."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Compare these two faces and determine:
1. Are they the same person? (confidence 0-100)
2. Is the second image a live photo (not a photo of another photo/screen)?
3. Face quality issues (blur, angle, lighting)

Return ONLY JSON in this exact format:
{
  "same_person": true/false,
  "confidence": 0-100,
  "is_live_photo": true/false,
  "liveness_confidence": 0-100,
  "quality_issues": [],
  "reasoning": "brief explanation"
}`
          },
          {
            type: "image_url",
            image_url: {
              url: referencePhotoUrl,
              detail: "high"
            }
          },
          {
            type: "image_url", 
            image_url: {
              url: checkInPhotoUrl,
              detail: "high"
            }
          }
        ]
      }
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",  // UPDATED MODEL
      messages: messages,
      max_tokens: 300,
      temperature: 0.1,
    });

    const content = response.choices[0].message.content;
    console.log('OpenAI raw response:', content);
    
    // Parse the JSON response
    let result;
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError);
      throw new Error('Invalid response format from face verification');
    }

    console.log('📊 Face comparison result:', result);

    // Check liveness if enabled
    if (checkLiveness && !result.is_live_photo) {
      console.warn('⚠️ Liveness check failed - possible photo of photo detected');
      return {
        isMatch: false,
        confidence: 0,
        details: {
          ...result,
          failure_reason: 'liveness_check_failed',
          message: 'Please use a live photo, not a photo of another photo or screen'
        }
      };
    }

    // Apply confidence threshold (80%)
    const CONFIDENCE_THRESHOLD = 80;
    const isMatch = result.same_person && result.confidence >= CONFIDENCE_THRESHOLD;

    return {
      isMatch: isMatch,
      confidence: result.confidence / 100, // Convert to 0-1 scale
      details: {
        same_person: result.same_person,
        confidence_percentage: result.confidence,
        is_live_photo: result.is_live_photo,
        liveness_confidence: result.liveness_confidence,
        quality_issues: result.quality_issues || [],
        reasoning: result.reasoning,
        threshold_used: CONFIDENCE_THRESHOLD
      }
    };

  } catch (error) {
    console.error('Face comparison error:', error);
    
    // Check for specific OpenAI errors
    if (error.code === 'insufficient_quota') {
      throw new Error('Face verification service quota exceeded');
    } else if (error.code === 'invalid_api_key') {
      throw new Error('Face verification service configuration error');
    }
    
    throw new Error('Face verification service unavailable');
  }
}


// API endpoint for getting directions
exports.getDirections = async (req, res) => {
  const { origin, destination } = req.query;

  if (!origin || !destination) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing origin or destination' 
    });
  }

  try {
    console.log('🗺️ Getting directions from', origin, 'to', destination);
    
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&departure_time=now&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    
    const response = await axios.get(url);
    
    if (response.data.status === 'OK') {
      res.json({
        success: true,
        status: response.data.status,
        routes: response.data.routes
      });
    } else {
      res.status(400).json({
        success: false,
        status: response.data.status,
        error_message: response.data.error_message
      });
    }
  } catch (error) {
    console.error('❌ Directions API error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch directions',
      error: error.message
    });
  }
};


// Check-in for a block with face verification
// Replace the ENTIRE checkInBlock function with this fixed version:

exports.checkInBlock = async (req, res) => {
  const { block_id } = req.params;
  const { driver_id, check_in_time, location, face_photo_url } = req.body;
  const facePhotoFile = req.file; // Face photo from multer/cloudinary

  // Validate required fields
  if (!block_id || !driver_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: block_id and driver_id are required' 
    });
  }

  const client = await pool.connect();
  
  // Declare facePhotoUrl at the function scope so it's available in error handlers
  let facePhotoUrl = face_photo_url || null;

  try {
    await client.query('BEGIN');

    // 1. Get block, claim, and driver reference photo
    const claimQuery = `
      SELECT 
        bc.claim_id,
        bc.status as claim_status,
        bc.check_in_time as existing_check_in,
        b.block_id,
        b.start_time,
        b.end_time,
        b.location_id,
        l.store_latitude,
        l.store_longitude,
        l.time_zone_code,
        d.reference_face_photo_gcs_path,
        d.first_name,
        d.last_name
      FROM block_claims bc
      JOIN blocks b ON bc.block_id = b.block_id
      JOIN locations l ON b.location_id = l.location_id
      JOIN drivers d ON bc.driver_id = d.driver_id
      WHERE bc.block_id = $1 AND bc.driver_id = $2 AND bc.status = 'accepted'
    `;

    const claimResult = await client.query(claimQuery, [block_id, driver_id]);

    if (claimResult.rowCount === 0) {
      throw new Error('No active claim found for this block and driver');
    }

    const claim = claimResult.rows[0];

    // Check if already checked in
    if (claim.existing_check_in) {
      throw new Error('Already checked in for this block');
    }

    // 2. Validate check-in time window
    const now = new Date();
    const blockStart = new Date(claim.start_time);
    const checkInWindowStart = new Date(blockStart.getTime() - 45 * 60 * 1000); // 45 minutes before
    const checkInWindowEnd = new Date(blockStart.getTime() + 15 * 60 * 1000); // 15 minutes after

    if (now < checkInWindowStart) {
      const minutesUntilWindow = Math.round((checkInWindowStart.getTime() - now.getTime()) / 60000);
      throw new Error(`Check-in window hasn't opened yet. Please wait ${minutesUntilWindow} more minutes.`);
    }

    if (now > checkInWindowEnd) {
      throw new Error('Check-in window has closed. You can no longer check in for this block.');
    }

    // 3. Validate location if provided
    let distanceFromStore = null;
    if (location && location.latitude && location.longitude && claim.store_latitude && claim.store_longitude) {
      // Calculate distance using Haversine formula
      const R = 3959; // Earth's radius in miles
      const lat1 = location.latitude * Math.PI / 180;
      const lat2 = parseFloat(claim.store_latitude) * Math.PI / 180;
      const deltaLat = (parseFloat(claim.store_latitude) - location.latitude) * Math.PI / 180;
      const deltaLon = (parseFloat(claim.store_longitude) - location.longitude) * Math.PI / 180;

      const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      distanceFromStore = R * c;

      // Check if within required distance (0.5 miles)
      if (distanceFromStore > 0.5) {
        throw new Error(`You are too far from the store (${distanceFromStore.toFixed(2)} miles away). You must be within 0.5 miles to check in.`);
      }
    }

    // 4. Handle face verification
    let faceVerified = false;
    let verificationConfidence = null;
    let verificationDetails = null;

    if (facePhotoUrl) {
      // Get verification details from check_in_verifications table
      const verificationQuery = `
        SELECT 
          verification_status,
          confidence_score,
          verification_method,
          face_photo_url
        FROM check_in_verifications
        WHERE claim_id = $1
        ORDER BY verified_at DESC
        LIMIT 1
      `;
      
      const verificationResult = await client.query(verificationQuery, [claim.claim_id]);
      
      if (verificationResult.rowCount > 0) {
        const verification = verificationResult.rows[0];
        faceVerified = verification.verification_status;
        verificationConfidence = verification.confidence_score;
        // Update facePhotoUrl from the verification record if not provided
        if (!facePhotoUrl && verification.face_photo_url) {
          facePhotoUrl = verification.face_photo_url;
        }
        
        if (!faceVerified) {
          throw new Error('Face verification failed. Please try the verification process again.');
        }
      } else {
        faceVerified = true;
        verificationConfidence = 1.0;
      }
    } else {
      throw new Error('Face photo verification is required for check-in');
    }

    // 5. Update block_claims with check-in info
    const updateClaimQuery = `
      UPDATE block_claims 
      SET 
        check_in_time = COALESCE($1, NOW()),
        service_status = 'in_progress',
        check_in_location_lat = $2,
        check_in_location_lng = $3,
        check_in_face_verified = $4
      WHERE claim_id = $5
      RETURNING *
    `;

    const checkInTime = check_in_time ? new Date(check_in_time) : new Date();
    const updateResult = await client.query(updateClaimQuery, [
      checkInTime,
      location?.latitude || null,
      location?.longitude || null,
      faceVerified,
      claim.claim_id
    ]);

    // 6. Store verification details if face photo was provided
    if (facePhotoUrl) {
      const insertVerificationQuery = `
        INSERT INTO check_in_verifications 
          (claim_id, face_photo_url, verification_status, confidence_score, verification_method, verified_at)
        VALUES 
          ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (claim_id) DO UPDATE
        SET 
          face_photo_url = EXCLUDED.face_photo_url,
          verification_status = EXCLUDED.verification_status,
          confidence_score = EXCLUDED.confidence_score,
          verified_at = NOW()
      `;

      await client.query(insertVerificationQuery, [
        claim.claim_id,
        facePhotoUrl,
        faceVerified,
        verificationConfidence,
        claim.reference_face_photo_url ? 'ai' : 'first_checkin'
      ]);
    }

    await client.query('COMMIT');

    console.log(`✅ Driver ${driver_id} checked in for block ${block_id}`, {
      faceVerified,
      confidence: verificationConfidence
    });

    // WEBSOCKET: Emit check-in status change
if (global.socketIO && global.socketIO.emitCheckInStatusChanged) {
  global.socketIO.emitCheckInStatusChanged(
    driver_id, 
    block_id, 
    'checked_in', 
    claim.claim_id
  );
  console.log(`🔌 Emitted check-in-status-changed event for driver ${driver_id}`);
}


    // Award Pizza Points for fast check-in (within 5 minutes of block start)
const checkInMinutesBeforeStart = Math.round((blockStart.getTime() - checkInTime.getTime()) / 60000);
if (checkInMinutesBeforeStart >= -5 && checkInMinutesBeforeStart <= 5) {
  await client.query(`
    INSERT INTO pizza_points (driver_id, event_type, points, event_time, block_id, claim_id, metadata)
    VALUES ($1, $2, $3, NOW(), $4, $5, $6)
  `, [
    driver_id,
    'fast_checkin',
    5,
    block_id,
    claim.claim_id,
    JSON.stringify({
      check_in_time: checkInTime.toISOString(),
      block_start_time: blockStart.toISOString(),
      minutes_difference: checkInMinutesBeforeStart
    })
  ]);
  console.log(`🍕 Awarded 5 PP for fast check-in to driver ${driver_id}`);
}

    res.json({
      success: true,
      check_in_time: checkInTime.toISOString(),
      service_status: 'in_progress',
      message: 'Check-in successful',
      details: {
        block_id: parseInt(block_id),
        driver_id: parseInt(driver_id),
        claim_id: claim.claim_id,
        check_in_location: location ? {
          latitude: location.latitude,
          longitude: location.longitude,
          distance_from_store: distanceFromStore ? parseFloat(distanceFromStore.toFixed(2)) : null
        } : null,
        face_verification: facePhotoUrl ? {
          verified: faceVerified,
          confidence: verificationConfidence,
          photo_url: facePhotoUrl,
          method: claim.reference_face_photo_url ? 'comparison' : 'first_checkin'
        } : null
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    
    // Clean up uploaded photo if transaction failed
    if (facePhotoUrl) {
      try {
        // Extract public_id from the URL
        const urlParts = facePhotoUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        const publicId = `driver-check-ins/${filename.split('.')[0]}`;
        await cloudinary.uploader.destroy(publicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup uploaded photo:', cleanupError);
      }
    }
    
    console.error('❌ Check-in error:', err.message);
    res.status(400).json({ 
      success: false, 
      message: err.message 
    });
  } finally {
    client.release();
  }
};

// Get check-in status for a block
exports.getCheckInStatus = async (req, res) => {
  const { block_id } = req.params;
  const { driver_id } = req.query;

  if (!block_id || !driver_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required parameters: block_id and driver_id' 
    });
  }

  try {
    const query = `
      SELECT 
        bc.claim_id,
        bc.check_in_time,
        bc.service_status,
        bc.check_in_location_lat,
        bc.check_in_location_lng,
        bc.check_in_face_verified,
        cv.face_photo_url,
        cv.verification_status,
        cv.confidence_score,
        cv.verification_method,
        cv.verified_at
      FROM block_claims bc
      LEFT JOIN check_in_verifications cv ON bc.claim_id = cv.claim_id
      WHERE bc.block_id = $1 AND bc.driver_id = $2 AND bc.status = 'accepted'
    `;

    const result = await pool.query(query, [block_id, driver_id]);

    if (result.rowCount === 0) {
      return res.json({
        success: true,
        checked_in: false,
        message: 'No active claim found for this block and driver'
      });
    }

    const claim = result.rows[0];
    const isCheckedIn = claim.check_in_time !== null;

    res.json({
      success: true,
      checked_in: isCheckedIn,
      check_in_time: claim.check_in_time,
      service_status: claim.service_status,
      check_in_location: claim.check_in_location_lat && claim.check_in_location_lng ? {
        latitude: parseFloat(claim.check_in_location_lat),
        longitude: parseFloat(claim.check_in_location_lng)
      } : null,
      face_verification: claim.face_photo_url ? {
        verified: claim.check_in_face_verified || claim.verification_status,
        confidence: claim.confidence_score,
        method: claim.verification_method,
        verified_at: claim.verified_at,
        photo_url: claim.face_photo_url
      } : null
    });

  } catch (err) {
    console.error('❌ Error getting check-in status:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

// Upload or update driver reference photo (for onboarding or profile updates)
exports.uploadDriverReferencePhoto = async (req, res) => {
  const { driver_id } = req.body;
  const photoFile = req.file;

  if (!driver_id || !photoFile) {
    return res.status(400).json({
      success: false,
      message: 'Missing driver_id or photo'
    });
  }

  try {
    const photoUrl = photoFile.path || photoFile.secure_url;

    // Update driver's reference photo
    const result = await pool.query(
      'UPDATE drivers SET reference_face_photo_gcs_path = $1, reference_face_uploaded_at = NOW() WHERE driver_id = $2',
      [photoUrl, driver_id]
    );

    if (result.rowCount === 0) {
      throw new Error('Driver not found');
    }

    // Need to fetch the driver data since UPDATE doesn't return it by default
const driverResult = await pool.query(
  'SELECT driver_id, first_name, last_name FROM drivers WHERE driver_id = $1',
  [driver_id]
);
const driver = driverResult.rows[0];

    console.log(`✅ Reference photo uploaded for driver ${driver_id} (${driver.first_name} ${driver.last_name})`);

    res.json({
      success: true,
      message: 'Reference photo uploaded successfully',
      photo_url: photoUrl,
      driver: {
        driver_id: driver.driver_id,
        name: `${driver.first_name} ${driver.last_name}`
      }
    });

  } catch (error) {
    console.error('Reference photo upload error:', error);
    
    // Clean up uploaded photo if database update failed
    if (photoFile && photoFile.public_id) {
      try {
        await cloudinary.uploader.destroy(photoFile.public_id);
      } catch (cleanupError) {
        console.error('Failed to cleanup uploaded photo:', cleanupError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload reference photo'
    });
  }
};




//Updated uploadCheckInFace endpoint
//a separate endpoint for face photo upload (optional but cleaner):
exports.uploadCheckInFace = async (req, res) => {
  const { block_id } = req.params;
  const { driver_id, face_photo_base64 } = req.body;

  if (!face_photo_base64 || !driver_id) {
    return res.status(400).json({
      success: false,
      message: 'Missing photo or driver_id'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get claim and driver info
    const claimQuery = `
      SELECT 
        bc.claim_id,
        bc.status as claim_status,
        d.reference_face_photo_gcs_path,
        d.first_name,
        d.last_name
      FROM block_claims bc
      JOIN drivers d ON bc.driver_id = d.driver_id
      WHERE bc.block_id = $1 AND bc.driver_id = $2 AND bc.status = 'accepted'
    `;

    const claimResult = await client.query(claimQuery, [block_id, driver_id]);

    if (claimResult.rowCount === 0) {
      throw new Error('No active claim found for this block and driver');
    }

    const claim = claimResult.rows[0];
    const driver = {
      first_name: claim.first_name,
      last_name: claim.last_name,
      reference_face_photo_gcs_path: claim.reference_face_photo_gcs_path
    };

    // Check previous attempts
    const attemptQuery = `
      SELECT attempt_count, last_attempt_at 
      FROM check_in_verifications 
      WHERE claim_id = $1
    `;
    const attemptResult = await client.query(attemptQuery, [claim.claim_id]);
    const previousAttempts = attemptResult.rows[0]?.attempt_count || 0;
    
    if (previousAttempts >= 3) {
      await client.query('COMMIT');
      return res.status(400).json({
        success: false,
        message: 'Maximum face verification attempts (3) exceeded. Please contact support.',
        attempts_remaining: 0
      });
    }

    // Upload base64 to cloudinary
    const uploadResult = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${face_photo_base64}`,
      {
        folder: 'driver-check-ins',
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'limit' }
        ]
      }
    );
    
    const facePhotoUrl = uploadResult.secure_url;
    console.log('✅ Face photo uploaded to Cloudinary:', facePhotoUrl);

    // If no reference photo, this becomes the reference
    if (!driver.reference_face_photo_gcs_path) {
      await client.query(
        'UPDATE drivers SET reference_face_photo_gcs_path = $1, reference_face_uploaded_at = NOW() WHERE driver_id = $2',
        [facePhotoUrl, driver_id]
      );
      
      // Record successful first check-in
      await client.query(`
        INSERT INTO check_in_verifications 
          (claim_id, face_photo_url, verification_status, confidence_score, 
           verification_method, verified_at, attempt_count)
        VALUES 
          ($1, $2, true, 1.0, 'first_checkin', NOW(), 1)
        ON CONFLICT (claim_id) DO UPDATE
        SET 
          face_photo_url = EXCLUDED.face_photo_url,
          verification_status = EXCLUDED.verification_status,
          confidence_score = EXCLUDED.confidence_score,
          verification_method = EXCLUDED.verification_method,
          verified_at = NOW()
      `, [claim.claim_id, facePhotoUrl]);
      
      await client.query('COMMIT');
      
      console.log('📸 First check-in photo saved as reference for driver:', driver_id);
      
      return res.json({
        success: true,
        face_photo_url: facePhotoUrl,
        verified: true,
        confidence: 1.0,
        message: 'First check-in photo saved as reference',
        driver_name: `${driver.first_name} ${driver.last_name}`
      });
    }

    // Compare with reference photo using OpenAI
    console.log('🔍 Comparing faces with OpenAI Vision API...');
    
    try {
      // Get signed URL for the GCS reference photo
const referencePhotoUrl = await getGCSImageUrl(driver.reference_face_photo_gcs_path);

const comparisonResult = await compareFaces(
  referencePhotoUrl, 
  facePhotoUrl,
  true // Enable liveness detection
);
      
      console.log('📊 Face comparison result:', {
        isMatch: comparisonResult.isMatch,
        confidence: comparisonResult.confidence,
        details: comparisonResult.details
      });

      const currentAttempt = previousAttempts + 1;

      // Record the verification attempt
      await client.query(`
        INSERT INTO check_in_verifications 
          (claim_id, face_photo_url, verification_status, confidence_score, 
           verification_method, verified_at, attempt_count, last_attempt_at)
        VALUES 
          ($1, $2, $3, $4, $5, NOW(), $6, NOW())
        ON CONFLICT (claim_id) DO UPDATE
        SET 
          attempt_count = $6,
          last_attempt_at = NOW(),
          face_photo_url = EXCLUDED.face_photo_url,
          verification_status = EXCLUDED.verification_status,
          confidence_score = EXCLUDED.confidence_score,
          verification_method = EXCLUDED.verification_method,
          verified_at = CASE WHEN EXCLUDED.verification_status THEN NOW() ELSE check_in_verifications.verified_at END
      `, [
        claim.claim_id,
        facePhotoUrl,
        comparisonResult.isMatch,
        comparisonResult.confidence,
        'openai_vision',
        currentAttempt
      ]);

      await client.query('COMMIT');

      if (!comparisonResult.isMatch) {
        // Clean up the failed photo
        try {
          const publicId = uploadResult.public_id;
          await cloudinary.uploader.destroy(publicId);
          console.log('🗑️ Cleaned up failed verification photo');
        } catch (cleanupError) {
          console.error('Failed to cleanup photo:', cleanupError);
        }

        // Determine specific error message
        let errorMessage = '';
        const details = comparisonResult.details;
        
        if (details.failure_reason === 'liveness_check_failed') {
          errorMessage = details.message || 'Please use a live photo, not a photo of another photo or screen.';
        } else if (details.quality_issues && details.quality_issues.length > 0) {
          errorMessage = `Photo quality issues: ${details.quality_issues.join(', ')}.`;
        } else {
          errorMessage = `Face did not match (${Math.round(details.confidence_percentage || 0)}% confidence, need 80%).`;
        }
        
        const attemptsRemaining = 3 - currentAttempt;
        if (attemptsRemaining > 0) {
          errorMessage += ` You have ${attemptsRemaining} attempt${attemptsRemaining > 1 ? 's' : ''} remaining.`;
        }

        return res.status(400).json({
          success: false,
          message: errorMessage,
          verified: false,
          confidence: comparisonResult.confidence,
          attempts_remaining: attemptsRemaining,
          details: {
            confidence_percentage: details.confidence_percentage,
            threshold_required: 80,
            quality_issues: details.quality_issues,
            is_live_photo: details.is_live_photo
          }
        });
      }

      // Success!
      res.json({
        success: true,
        face_photo_url: facePhotoUrl,
        verified: true,
        confidence: comparisonResult.confidence,
        reference_photo_url: driver.reference_face_photo_gcs_path,
        driver_name: `${driver.first_name} ${driver.last_name}`,
        message: 'Face verified successfully'
      });

    } catch (verificationError) {
      // Service error - don't count as failed attempt
      console.error('❌ Face verification service error:', verificationError);
      
      // Clean up the photo
      try {
        await cloudinary.uploader.destroy(uploadResult.public_id);
      } catch (cleanupError) {
        console.error('Failed to cleanup photo:', cleanupError);
      }

      await client.query('ROLLBACK');
      
      return res.status(503).json({
        success: false,
        message: 'Face verification service temporarily unavailable. Please try again.',
        attempts_remaining: 3 - previousAttempts
      });
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Face upload error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to process face verification'
    });
  } finally {
    client.release();
  }
};







// 3. UPDATE: getBlockDetails - Include manager info
exports.getBlockDetails = async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);
    const claimId = parseInt(req.query.claim_id) || 0;
    
    console.log(`➡️ GET /api/blocks/${blockId}/details?claim_id=${claimId}`);
    
    // UPDATED QUERY: Include manager information
    const blockQuery = `
      SELECT 
        b.block_id,
        b.start_time,
        b.end_time,
        b.amount,
        b.status,
        b.location_id,
        b.manager_id,  -- ADD: Include manager_id
        l.city,
        l.region,
        l.time_zone_code,
        l.store_id,
        l.street_name,
        l.phone,
        m.first_name as manager_first_name,  -- ADD: Manager details
        m.last_name as manager_last_name,
        m.phone_number as manager_phone
      FROM blocks b
      LEFT JOIN locations l ON b.location_id = l.location_id
      LEFT JOIN managers m ON b.manager_id = m.manager_id  -- ADD: Join with managers
      WHERE b.block_id = $1
    `;
    
    const blockResult = await pool.query(blockQuery, [blockId]);
    
    if (blockResult.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }
    
    const block = blockResult.rows[0];
    
    // Get check-in time if available
    const checkInQuery = `
      SELECT check_in_time 
      FROM block_claims
      WHERE block_id = $1 
      ORDER BY check_in_time DESC 
      LIMIT 1
    `;
    
    const checkInResult = await pool.query(checkInQuery, [blockId]);
    const checkInTime = checkInResult.rows.length > 0 ? checkInResult.rows[0].check_in_time : null;
    
    // Format the response
    const response = {
      block: {
        block_id: block.block_id,
        startTime: block.start_time,
        endTime: block.end_time,
        amount: block.amount,
        status: block.status,
        locationId: block.location_id,
        city: block.city,
        region: block.region,
        timeZoneCode: block.time_zone_code,
        manager_id: block.manager_id,  // ADD: Include manager_id
        store: {
          storeId: block.store_id,
          address: block.street_name,
          phone: block.phone || '555-0123',
          timeZoneCode: block.time_zone_code
        }
      },
      checkInTime: checkInTime,
      claimId: claimId,
      manager: {  // UPDATED: Use actual manager data
        id: block.manager_id,
        name: block.manager_id ? `${block.manager_first_name || ''} ${block.manager_last_name || ''}`.trim() : 'Store Manager',
        phone: block.manager_phone || block.phone || '555-0123',
        profileImage: ''
      }
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching block details:', error);
    res.status(500).json({ error: 'Failed to fetch block details' });
  }
};