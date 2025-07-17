const cron = require('node-cron');
const { pool } = require('../db');

function startCronJobs() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      // 1. Expire unclaimed blocks that have already started
      await pool.query(`
        UPDATE blocks
        SET status = 'expired'
        WHERE status = 'available'
          AND (date::timestamp + start_time::time) < NOW()
          AND block_id NOT IN (
            SELECT block_id FROM block_claims
          );
      `);

      // 2. Set related block_claims status to expired
      await pool.query(`
        UPDATE block_claims
        SET status = 'expired',
            service_status = 'expired'
        WHERE block_id IN (
          SELECT block_id FROM blocks WHERE status = 'expired'
        )
        AND status != 'expired';
      `);

      console.log('✅ Expired blocks and claims updated!');
    } catch (err) {
      console.error('❌ Error updating expired blocks/claims:', err);
    }
  });
}

module.exports = { startCronJobs };
