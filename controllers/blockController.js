// FLEX-BACKEND/controllers/blockController.js
const pool = require('../db');

exports.claimBlock = async (req, res) => {
  const { block_id, driver_id } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const blockRes = await client.query(
      'SELECT block_id, start_time, end_time, location_id FROM blocks WHERE block_id = $1',
      [block_id]
    );
    if (blockRes.rowCount === 0) throw new Error('Block not found');

    const { start_time, end_time } = blockRes.rows[0];
    const newStart = new Date(start_time);
    const newEnd = new Date(end_time);

    const blockDate = new Date(start_time);
    const startOfDay = new Date(blockDate.getFullYear(), blockDate.getMonth(), blockDate.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(blockDate.getFullYear(), blockDate.getMonth(), blockDate.getDate(), 23, 59, 59, 999);

    const existingClaims = await client.query(
      `SELECT b.start_time, b.end_time FROM block_claims bc JOIN blocks b ON bc.block_id = b.block_id WHERE bc.driver_id = $1 AND b.start_time BETWEEN $2 AND $3`,
      [driver_id, startOfDay, endOfDay]
    );

    let overlapCount = 0;
for (const row of existingClaims.rows) {
  const claimedStart = new Date(row.start_time);
  const claimedEnd = new Date(row.end_time);

  const isOverlap = newStart <= claimedEnd && newEnd >= claimedStart;
  if (isOverlap) overlapCount += 1;
}

if (overlapCount > 0) {
  throw new Error('You are allowed to accept overlapping blocks only once a day.');
}


    const dupCheck = await client.query('SELECT 1 FROM block_claims WHERE block_id = $1', [block_id]);
    if (dupCheck.rowCount > 0) {
      throw new Error('This block has already been claimed.');
    }

    const claimResult = await client.query(
      'INSERT INTO block_claims (block_id, driver_id, claim_time, status) VALUES ($1, $2, NOW(), $3) RETURNING *',
      [block_id, driver_id, 'accepted']
    );

    // NEW: Update block_claims status to accepted (defensive, in case you want explicit update)
    // You could technically skip this if you set it in the INSERT, but if you want to ensure status gets set:
    // const claimId = claimResult.rows[0].claim_id;
    // await client.query(
    //   'UPDATE block_claims SET status = $1 WHERE claim_id = $2',
    //   ['accepted', claimId]
    // );
    await client.query('UPDATE blocks SET status = $1 WHERE block_id = $2', ['accepted', block_id]);

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Block claimed successfully', data: claimResult.rows[0] });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Claim error:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.unclaimBlock = async (req, res) => {
  const { block_id, driver_id, override_penalty } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const blockResult = await client.query("SELECT start_time AT TIME ZONE 'UTC' AS start_time FROM blocks WHERE block_id = $1", [block_id]);
    if (blockResult.rowCount === 0) throw new Error('Block not found');

    const startTimeUtc = new Date(blockResult.rows[0].start_time);
    const nowUtc = new Date();
    const diffMinutes = (startTimeUtc.getTime() - nowUtc.getTime()) / (1000 * 60);

    if (diffMinutes <= 60 && !override_penalty) {
      return res.status(400).json({ warning: true, message: 'Unclaiming now will impact your standing. Confirm to proceed.' });
    }
    // 1. Fetch the claim_id before deleting
const claimRes = await client.query(
  `SELECT claim_id FROM block_claims WHERE block_id = $1 AND driver_id = $2`,
  [block_id, driver_id]
);
const claimId = claimRes.rows.length > 0 ? claimRes.rows[0].claim_id : null;
// 2. Delete the claim
    await client.query('DELETE FROM block_claims WHERE block_id = $1 AND driver_id = $2', [block_id, driver_id]);
    // 3. Update the block status
    await client.query('UPDATE blocks SET status = $1 WHERE block_id = $2', ['available', block_id]);
// 4. If late unclaim, log in pizza_points
    if (diffMinutes <= 60) {
      await client.query(
        `INSERT INTO pizza_points
          (driver_id, event_type, points, event_time, block_id, claim_id)
        VALUES
          ($1, $2, $3, NOW(), $4, $5)`,
       [driver_id, 'Forfeit within 60', -20, block_id, claimId]
     );
    }

    await client.query('COMMIT');
    res.status(200).json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Unclaim error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};
// API to get available blocks
exports.getAvailableBlocks = async (req, res) => {
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
        ) sub
        WHERE rn = 1
      )
      SELECT
        b.block_id,
        b.date,
        (b.date::timestamp + b.start_time::time)::timestamptz AT TIME ZONE 'UTC' AS start_time_utc,
        (b.date::timestamp + b.end_time::time)::timestamptz AT TIME ZONE 'UTC' AS end_time_utc,
        b.amount,
        b.status,
        b.location_id,
        lc.claim_id,
        l.store_id,
        l.street_name,
        l.city,
        l.region,
        l.phone,
        l.postal_code,
        d.license_expiration,
        d.registration_expiration_date,
        i.end_date AS insurance_end
      FROM blocks AS b
      LEFT JOIN latest_claims lc ON b.block_id = lc.block_id
      INNER JOIN locations l ON b.location_id = l.location_id
      INNER JOIN drivers d ON d.driver_id = $1
      LEFT JOIN insurance_details i ON d.driver_id = i.driver_id
      WHERE b.status = 'available'
        AND lc.claim_id IS NULL
        AND d.license_expiration > NOW()
        AND d.registration_expiration_date > NOW()
        AND i.end_date > NOW()
        AND (b.date::timestamp + b.start_time::time) > NOW()
      ORDER BY b.date, b.start_time
    `;

    const result = await pool.query(query, [driverIdInt]);
    const grouped = {};
    result.rows.forEach((row) => {
      const dateKey = row.date.toISOString().split('T')[0];
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push({
        block_id: row.block_id,
        startTime: row.start_time_utc.toISOString(),
        endTime: row.end_time_utc.toISOString(),
        amount: row.amount,
        locationId: row.location_id,
        city: row.city,
        region: row.region,
        store: {
          storeId: row.store_id,
          address: `${row.street_name}, ${row.city}, ${row.region} ${row.postal_code}`,
          phone: row.phone
        }
      });
    });

    res.json({ success: true, blocksByDate: grouped });
  } catch (err) {
    console.error('❌ Error fetching available blocks for driver:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

//get claimed blocks API
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
        lc.claim_time,
        l.store_id,
        l.street_name,
        l.city,
        l.region,
        l.phone,
        l.postal_code,
        l.store_latitude,
        l.store_longitude,
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
       b.location_id, lc.claim_time,
       l.store_id, l.street_name, l.city, l.region, l.phone, l.postal_code,
       l.store_latitude, l.store_longitude

      ORDER BY b.date, b.start_time
    `;

    const result = await pool.query(query, [driverIdInt]);
    const grouped = {};
    result.rows.forEach((row) => {
      const date = row.date ? row.date.toISOString().split('T')[0] : 'unknown';
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push({
        block_id: row.block_id,
        startTime: row.start_time?.toISOString() || null,
        endTime: row.end_time?.toISOString() || null,
        amount: row.amount,
        status: row.status,
        claimTime: row.claim_time?.toISOString() || null,
        locationId: row.location_id,
        city: row.city,
        region: row.region,
        store: {
          storeId: row.store_id,
          address: `${row.street_name}, ${row.city}, ${row.region} ${row.postal_code}`,
          phone: row.phone,
          latitude: row.store_latitude,
          longitude: row.store_longitude
        },
          managers: row.managers
      });
    });

    res.json({ success: true, blocksByDate: grouped });
  } catch (err) {
    console.error('❌ Error fetching claimed blocks for driver:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
