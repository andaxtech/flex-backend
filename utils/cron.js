// utils/cron.js
const cron = require('node-cron');
const pool = require('../db');

// Helper function to parse timezone offset
const parseTimezoneOffset = (timezoneCode) => {
  const match = timezoneCode.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return -480; // Default to PST offset (GMT-08:00)
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const mins = parseInt(match[3], 10);
  return sign * (hours * 60 + mins);
};

// Helper function to check if points already exist
const checkExistingPoints = async (blockId, claimId, eventType) => {
  const query = `
    SELECT id FROM pizza_points 
    WHERE block_id = $1 AND claim_id = $2 AND event_type = $3
  `;
  const result = await pool.query(query, [blockId, claimId, eventType]);
  return result.rows.length > 0;
};

// Helper function to log pizza points
const logPizzaPoints = async (driverId, eventType, points, blockId, claimId) => {
  // Check if points already logged
  const exists = await checkExistingPoints(blockId, claimId, eventType);
  if (exists) {
    console.log(`🍕 Points already logged for block ${blockId}, claim ${claimId}, event ${eventType}`);
    return false;
  }

  const query = `
    INSERT INTO pizza_points (driver_id, event_type, points, event_time, block_id, claim_id)
    VALUES ($1, $2, $3, NOW(), $4, $5)
  `;
  await pool.query(query, [driverId, eventType, points, blockId, claimId]);
  console.log(`🍕 Logged ${points} points for driver ${driverId}: ${eventType}`);
  return true;
};

// Function to handle expired available blocks and their claims
const handleExpiredAvailableBlocks = async (expiredBlockIds) => {
  if (expiredBlockIds.length === 0) return;

  // Update block_claims for expired blocks
  const claimsQuery = `
    UPDATE block_claims
    SET status = 'expired', service_status = 'Unserviced'
    WHERE block_id = ANY($1) AND status = 'available'
    RETURNING block_id, claim_id
  `;
  
  const claimsResult = await pool.query(claimsQuery, [expiredBlockIds]);
  console.log(`📝 Updated ${claimsResult.rowCount} block claims to expired/unserviced`);
};

// Function to handle accepted blocks
const handleAcceptedBlocks = async () => {
  try {
    // Get all accepted blocks that have passed their start time
    const acceptedBlocksQuery = `
      SELECT 
        b.block_id,
        b.start_time,
        b.end_time,
        b.status,
        l.time_zone_code,
        bc.claim_id,
        bc.driver_id,
        bc.check_in_time,
        bc.check_out_time,
        bc.service_status
      FROM blocks b
      INNER JOIN locations l ON b.location_id = l.location_id
      LEFT JOIN block_claims bc ON b.block_id = bc.block_id
      WHERE b.status = 'accepted' AND bc.status = 'accepted'
      ORDER BY b.start_time
    `;
    
    const result = await pool.query(acceptedBlocksQuery);
    const acceptedBlocks = result.rows;
    
    if (acceptedBlocks.length === 0) {
      console.log('📊 No accepted blocks to process');
      return;
    }
    
    console.log(`📊 Processing ${acceptedBlocks.length} accepted blocks...`);
    
    const nowUtc = new Date();
    
    for (const block of acceptedBlocks) {
      try {
        const {
          block_id,
          claim_id,
          driver_id,
          start_time,
          end_time,
          time_zone_code,
          check_in_time,
          check_out_time,
          service_status
        } = block;
        
        // Skip if already processed (has a final service status)
        if (['Block Complete', 'No Show', 'Incomplete Block'].includes(service_status)) {
          continue;
        }
        
        // Parse timezone offset
        const offsetMinutes = parseTimezoneOffset(time_zone_code || 'GMT-08:00');
        
        // Convert times to store's local timezone
        const storeLocalNow = new Date(nowUtc.getTime() + offsetMinutes * 60000);
        const blockStartLocal = new Date(new Date(start_time).getTime() + offsetMinutes * 60000);
        const blockEndLocal = new Date(new Date(end_time).getTime() + offsetMinutes * 60000);
        
        // Check if block start time has passed in store timezone
        if (blockStartLocal > storeLocalNow) {
          continue; // Block hasn't started yet
        }
        
        let newServiceStatus = service_status;
        let pointsToLog = [];
        
        // Define time windows
        const earlyCheckInWindow = new Date(blockStartLocal.getTime() - 10 * 60000); // 10 min before
        const lateCheckInWindow = new Date(blockStartLocal.getTime() + 5 * 60000); // 5 min after
        
        // Convert check-in/out times to store timezone if they exist
        const checkInLocal = check_in_time ? 
          new Date(new Date(check_in_time).getTime() + offsetMinutes * 60000) : null;
        const checkOutLocal = check_out_time ? 
          new Date(new Date(check_out_time).getTime() + offsetMinutes * 60000) : null;
        
        // Determine service status and points
        if (!checkInLocal) {
          // No check-in at all
          if (storeLocalNow > lateCheckInWindow) {
            newServiceStatus = 'No Show';
            pointsToLog.push({
              eventType: 'no_show',
              points: -30
            });
          }
        } else if (checkInLocal && !checkOutLocal) {
          // Checked in but not checked out
          newServiceStatus = 'In Progress';
        } else if (checkInLocal && checkOutLocal) {
          // Both check-in and check-out exist
          const validCheckIn = checkInLocal >= earlyCheckInWindow && checkInLocal <= lateCheckInWindow;
          const earlyCheckIn = checkInLocal >= earlyCheckInWindow && checkInLocal < blockStartLocal;
          const completeCheckOut = checkOutLocal >= blockEndLocal;
          
          if (validCheckIn && completeCheckOut) {
            newServiceStatus = 'Block Complete';
            
            // Early check-in bonus
            if (earlyCheckIn) {
              pointsToLog.push({
                eventType: 'early_check_in',
                points: 5
              });
            }
          } else if (validCheckIn && checkOutLocal < blockEndLocal) {
            newServiceStatus = 'Incomplete Block';
            pointsToLog.push({
              eventType: 'incomplete_block',
              points: -20
            });
          }
        }
        
        // Update service status if changed
        if (newServiceStatus !== service_status) {
          const updateQuery = `
            UPDATE block_claims
            SET service_status = $1
            WHERE claim_id = $2
          `;
          await pool.query(updateQuery, [newServiceStatus, claim_id]);
          console.log(`✅ Updated claim ${claim_id} service status to: ${newServiceStatus}`);
          
          // Log any points
          for (const pointEvent of pointsToLog) {
            await logPizzaPoints(
              driver_id,
              pointEvent.eventType,
              pointEvent.points,
              block_id,
              claim_id
            );
          }
        }
        
      } catch (blockError) {
        console.error(`Error processing accepted block ${block.block_id}:`, blockError);
      }
    }
    
  } catch (error) {
    console.error('❌ Error processing accepted blocks:', error);
  }
};

// Main function to update expired blocks with proper timezone handling
const updateExpiredBlocks = async () => {
  try {
    console.log('🕒 Running expired blocks cleanup job with timezone handling...');
    
    // Get all available blocks with their store timezones
    const blocksQuery = `
      SELECT 
        b.block_id, 
        b.start_time, 
        b.status,
        l.time_zone_code
      FROM blocks b
      INNER JOIN locations l ON b.location_id = l.location_id
      WHERE b.status = 'available'
      ORDER BY b.start_time
    `;
    
    const blocksResult = await pool.query(blocksQuery);
    const blocks = blocksResult.rows;
    
    if (blocks.length === 0) {
      console.log('📊 No available blocks to check for expiration');
    } else {
      console.log(`📊 Checking ${blocks.length} available blocks for expiration with timezone awareness...`);
      
      const expiredBlockIds = [];
      const nowUtc = new Date();
      
      // Check each block against its store's local time
      for (const block of blocks) {
        try {
          const { block_id, start_time, time_zone_code } = block;
          
          // Parse timezone offset (e.g., "GMT-08:00" = -480 minutes)
          const offsetMinutes = parseTimezoneOffset(time_zone_code || 'GMT-08:00');
          
          // Convert current UTC time to store's local time
          const storeLocalNow = new Date(nowUtc.getTime() + offsetMinutes * 60000);
          
          // Convert block start time (UTC) to store's local time
          const blockStartUtc = new Date(start_time);
          const blockStartLocal = new Date(blockStartUtc.getTime() + offsetMinutes * 60000);
          
          // Compare local times: has the block started in the store's timezone?
          if (blockStartLocal <= storeLocalNow) {
            expiredBlockIds.push(block_id);
            
            console.log(`🕒 Block ${block_id} expired in store timezone:`, {
              storeTimezone: time_zone_code,
              blockStartUtc: blockStartUtc.toISOString(),
              blockStartLocal: blockStartLocal.toLocaleString(),
              storeLocalNow: storeLocalNow.toLocaleString(),
              minutesPastStart: Math.round((storeLocalNow.getTime() - blockStartLocal.getTime()) / 60000)
            });
          }
          
        } catch (blockError) {
          console.error(`Error processing block ${block.block_id}:`, blockError);
        }
      }
      
      // Update expired blocks in database
      if (expiredBlockIds.length > 0) {
        const placeholders = expiredBlockIds.map((_, index) => `$${index + 1}`).join(',');
        const updateQuery = `
          UPDATE blocks 
          SET status = 'expired' 
          WHERE block_id IN (${placeholders})
          AND status = 'available'
        `;
        
        const updateResult = await pool.query(updateQuery, expiredBlockIds);
        const updatedCount = updateResult.rowCount || 0;
        
        console.log(`✅ Successfully marked ${updatedCount} blocks as expired:`, expiredBlockIds);
        
        // Handle block claims for expired blocks
        await handleExpiredAvailableBlocks(expiredBlockIds);
      } else {
        console.log('📊 No available blocks needed to be marked as expired');
      }
    }
    
    // Process accepted blocks
    await handleAcceptedBlocks();
    
  } catch (error) {
    console.error('❌ Error in expired blocks cleanup job:', error);
  }
};

// Schedule job to run every 5 minutes
const startCronJobs = () => {
  // Runs every 5 minutes: "*/5 * * * *"
  cron.schedule('*/5 * * * *', updateExpiredBlocks, {
    scheduled: true,
    timezone: "UTC"
  });
  
  console.log('📅 Expired blocks cleanup job scheduled (every 5 minutes) with timezone awareness');
};

// Run once on startup to clean up any existing expired blocks
const runInitialCleanup = async () => {
  console.log('🚀 Running initial expired blocks cleanup with timezone awareness...');
  await updateExpiredBlocks();
};

module.exports = {
  startCronJobs,
  runInitialCleanup,
  updateExpiredBlocks
};