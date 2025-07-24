// utils/cron.js
const cron = require('node-cron');
const pool = require('../db');

// Helper function to parse timezone offset (same as frontend)
const fixedOffsetToMinutes = (offsetStr) => {
  const match = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const mins = parseInt(match[3], 10);
  return sign * (hours * 60 + mins);
};

// Function to update expired blocks with timezone awareness
const updateExpiredBlocks = async () => {
  try {
    console.log('🕒 Running expired blocks cleanup job with timezone awareness...');
    
    // Get all available blocks with their store timezones
    const blocksQuery = `
      SELECT 
        b.block_id, 
        b.start_time, 
        l.time_zone_code
      FROM blocks b
      INNER JOIN locations l ON b.location_id = l.location_id
      WHERE b.status = 'available'
    `;
    
    const blocksResult = await pool.query(blocksQuery);
    const blocks = blocksResult.rows;
    
    if (blocks.length === 0) {
      console.log('📊 No available blocks to check for expiration');
      return 0;
    }
    
    console.log(`📊 Checking ${blocks.length} available blocks for expiration...`);
    
    const expiredBlockIds = [];
    const nowUtc = new Date();
    
    // Check each block against its store's current time
    for (const block of blocks) {
      try {
        const { block_id, start_time, time_zone_code } = block;
        
        // Parse the store timezone offset
        const offsetMinutes = fixedOffsetToMinutes(time_zone_code || 'GMT-08:00');
        
        // Convert current UTC time to store local time
        const storeLocalNow = new Date(nowUtc.getTime() + offsetMinutes * 60000);
        
        // Convert block start time to store local time for comparison
        const blockStartUtc = new Date(start_time);
        const blockStartLocal = new Date(blockStartUtc.getTime() + offsetMinutes * 60000);
        
        // Check if block has started in store's local time
        if (blockStartLocal <= storeLocalNow) {
          expiredBlockIds.push(block_id);
          
          console.log(`🕒 Block ${block_id} expired:`, {
            storeTimezone: time_zone_code,
            blockStartUtc: blockStartUtc.toISOString(),
            blockStartLocal: blockStartLocal.toISOString(),
            storeLocalNow: storeLocalNow.toISOString(),
            minutesPassed: Math.round((storeLocalNow.getTime() - blockStartLocal.getTime()) / 60000)
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
      `;
      
      const updateResult = await pool.query(updateQuery, expiredBlockIds);
      const updatedCount = updateResult.rowCount || 0;
      
      console.log(`✅ Successfully marked ${updatedCount} blocks as expired:`, expiredBlockIds);
      return updatedCount;
    } else {
      console.log('📊 No blocks needed to be marked as expired');
      return 0;
    }
    
  } catch (error) {
    console.error('❌ Error in expired blocks cleanup job:', error);
    return 0;
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