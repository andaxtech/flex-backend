// utils/cron.js
const cron = require('node-cron');
const pool = require('../db');

// Function to update expired blocks (only available blocks that are in the past)
const updateExpiredBlocks = async () => {
  try {
    console.log('🕒 Running expired blocks cleanup job...');
    
    // Only update blocks that are:
    // 1. status = 'available' (unclaimed)
    // 2. start_time has passed (in the past)
    const updateQuery = `
      UPDATE blocks 
      SET status = 'expired' 
      WHERE status = 'available' 
      AND start_time < NOW()
      RETURNING block_id, start_time
    `;
    
    const result = await pool.query(updateQuery);
    const updatedCount = result.rowCount || 0;
    
    if (updatedCount > 0) {
      console.log(`✅ Successfully marked ${updatedCount} available blocks as expired`);
      
      // Log details of expired blocks
      result.rows.forEach(block => {
        console.log(`📋 Block ${block.block_id}: start_time ${block.start_time.toISOString()}`);
      });
    } else {
      console.log('📊 No available blocks needed to be marked as expired');
    }
    
    // Log some stats for debugging
    const statsQuery = `
      SELECT 
        status,
        COUNT(*) as count,
        MIN(start_time) as earliest,
        MAX(start_time) as latest
      FROM blocks 
      WHERE start_time < NOW()
      GROUP BY status
      ORDER BY status
    `;
    
    const statsResult = await pool.query(statsQuery);
    console.log('📊 Past blocks summary:', statsResult.rows);
    
    return updatedCount;
    
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
  
  console.log('📅 Expired blocks cleanup job scheduled (every 5 minutes)');
  console.log('📝 Job will expire ONLY available blocks that are in the past');
};

// Run once on startup to clean up any existing expired blocks
const runInitialCleanup = async () => {
  console.log('🚀 Running initial expired blocks cleanup...');
  console.log('📝 Only expiring available blocks (not accepted ones)');
  await updateExpiredBlocks();
};

module.exports = {
  startCronJobs,
  runInitialCleanup,
  updateExpiredBlocks
};