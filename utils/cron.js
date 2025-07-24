// utils/cron.js
const cron = require('node-cron');
const pool = require('../db');

// Function to update expired blocks
const updateExpiredBlocks = async () => {
  try {
    console.log('🕒 Running expired blocks cleanup job...');
    
    // Update blocks where start_time has passed and status is still 'available'
    const result = await pool.query(`
      UPDATE blocks 
      SET status = 'expired' 
      WHERE start_time < NOW() 
      AND status = 'available'
    `);
    
    const updatedCount = result.rowCount || 0;
    
    if (updatedCount > 0) {
      console.log(`✅ Marked ${updatedCount} blocks as expired`);
    } else {
      console.log('📊 No blocks needed to be marked as expired');
    }
    
    return updatedCount;
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
  
  console.log('📅 Expired blocks cleanup job scheduled (every 5 minutes)');
};

// Run once on startup to clean up any existing expired blocks
const runInitialCleanup = async () => {
  console.log('🚀 Running initial expired blocks cleanup...');
  await updateExpiredBlocks();
};

module.exports = {
  startCronJobs,
  runInitialCleanup,
  updateExpiredBlocks
};