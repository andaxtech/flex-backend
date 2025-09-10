// FLEX-BACKEND/controllers/deliveryController.js
const pool = require('../db');
const extractText = require('../utils/ocr');
const uploadImage = require('../utils/upload');

// Add this at the top with other requires
const fixedOffsetToMinutes = (offsetStr) => {
  const match = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const mins = parseInt(match[3], 10);
  return sign * (hours * 60 + mins);
};

exports.startDelivery = async (req, res) => {
  const { driver_id, block_id, claim_id, device_local_time } = req.body;
  const filePath = req.file?.path;
  
  if (!driver_id || !filePath) {
    return res.status(400).json({ success: false, error: 'Missing driver_id or photo' });
  }

  try {
    const imageUrl = await uploadImage(filePath);
    const ocrResult = await extractText(imageUrl);

    const {
      order_number = null,
      order_total = null,
      customer_name = null,
      slice_number = null,
      total_slices = null,
      order_type = null,
      payment_status = null,
      order_time = null,
      order_date = null,
      phone_number = null
    } = typeof ocrResult === 'object' ? ocrResult : {};

    // Get store_id from the most recent block claim
    const storeQuery = await pool.query(
      `SELECT l.store_id
       FROM block_claims bc
       JOIN blocks b ON bc.block_id = b.block_id
       JOIN locations l ON b.location_id = l.location_id
       WHERE bc.driver_id = $1
       ORDER BY bc.claim_time DESC
       LIMIT 1`,
      [driver_id]
    );
    const store_id = storeQuery.rows[0]?.store_id || null;

    const insertQuery = `
      INSERT INTO delivery_logs (
        driver_id,
        order_number,
        order_total,
        customer_name,
        store_id,
        delivery_photo_url,
        ocr_text,
        ocr_status,
        slice_number,
        total_slices,
        order_type,
        payment_status,
        order_time,
        order_date,
        phone_number,
        block_id,
        claim_id,
        device_created_time,
        delivery_started_at,
        delivery_status,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 
        $11, $12, $13, $14, $15, $16, $17, $18, 
        NOW(),
        'in_progress',
        NOW()
      ) RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      driver_id,
      order_number,
      order_total ? parseFloat(order_total) : null,
      customer_name,
      store_id,
      imageUrl,
      JSON.stringify(ocrResult),
      'parsed',
      slice_number ? parseInt(slice_number) : null,
      total_slices ? parseInt(total_slices) : null,
      order_type,
      payment_status,
      order_time,
      order_date,
      phone_number,
      block_id || null,
      claim_id || null,
      device_local_time || null
    ]);

    // Return the delivery with ocr_data included
    const delivery = result.rows[0];
    
    res.json({ 
      success: true, 
      delivery: {
        ...delivery,
        ocr_data: ocrResult  // Include the parsed OCR data for the frontend
      }
    });
  } catch (error) {
    console.error('❌ Delivery start failed:', error);
    res.status(500).json({ success: false, error: error.message || 'OCR failed or upload error' });
  }
}; // THIS WAS MISSING!

exports.completeDelivery = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const deliveryLogId = parseInt(req.params.deliveryLogId);
    const { completed_at, device_local_time } = req.body;
    
    // Update the delivery log with all completion timestamps
    const updateQuery = `
      UPDATE delivery_logs 
      SET 
        delivery_completed_at = $2,
        completed_at = $2,
        device_completed_time = $3,
        delivery_status = 'completed'
      WHERE delivery_id = $1
      RETURNING *
    `;
    
    const result = await client.query(updateQuery, [
      deliveryLogId,
      completed_at || new Date().toISOString(),
      device_local_time
    ]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        error: 'Delivery not found' 
      });
    }
    
    const completedDelivery = result.rows[0];
    
    // Calculate delivery duration for Pizza Points
    const startTime = new Date(completedDelivery.created_at).getTime();
    const endTime = new Date(completedDelivery.completed_at).getTime();
    const durationSeconds = Math.floor((endTime - startTime) / 1000);
    const deliveryMinutes = Math.floor(durationSeconds / 60);
    
    // Calculate Pizza Points based on delivery time
    let pizzaPoints = 5; // Default participation points
    let eventType = 'delivery_completed';
    
    if (deliveryMinutes <= 15) {
      pizzaPoints = 50;
      eventType = 'ultra_fast_delivery';
    } else if (deliveryMinutes <= 20) {
      pizzaPoints = 30;
      eventType = 'on_time_delivery';
    } else if (deliveryMinutes <= 25) {
      pizzaPoints = 20;
      eventType = 'on_time_delivery';
    } else if (deliveryMinutes <= 30) {
      pizzaPoints = 10;
      eventType = 'on_time_delivery';
    }

    // Award Pizza Points for delivery completion
    await client.query(`
      INSERT INTO pizza_points (driver_id, event_type, points, event_time, delivery_id, block_id, claim_id, metadata)
      VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
    `, [
      completedDelivery.driver_id,
      eventType,
      pizzaPoints,
      deliveryLogId,
      completedDelivery.block_id,
      completedDelivery.claim_id,
      JSON.stringify({
        delivery_time_minutes: deliveryMinutes,
        order_number: completedDelivery.order_number,
        order_total: completedDelivery.order_total,
        customer_name: completedDelivery.customer_name
      })
    ]);

    // Check for rush hour bonus (Thu-Sat 6-9PM in store's local time)
    if (completedDelivery.store_id) {
      const storeQuery = await client.query(`
        SELECT l.time_zone_code
        FROM locations l
        WHERE l.store_id = $1
      `, [completedDelivery.store_id]);

      if (storeQuery.rows.length > 0) {
        const { time_zone_code } = storeQuery.rows[0];
        
        // Parse the store's timezone offset
        const offsetMinutes = fixedOffsetToMinutes(time_zone_code);
        
        // Get the delivery creation time (when order was placed)
        const deliveryDateUTC = new Date(completedDelivery.created_at);
        
        // Convert to store local time using your formula: storeLocalTime = UTC + offsetMinutes
        const storeLocalTimeMs = deliveryDateUTC.getTime() + offsetMinutes * 60000;
        
        // Extract components manually to avoid JS Date timezone issues
        const totalMinutes = Math.floor(storeLocalTimeMs / 60000);
        const daysSinceEpoch = Math.floor(totalMinutes / (24 * 60));
        const dayMinutes = totalMinutes % (24 * 60);
        const hours = Math.floor(dayMinutes / 60);
        
        // Calculate day of week (0 = Sunday, 4 = Thursday, 5 = Friday, 6 = Saturday)
        // January 1, 1970 was a Thursday (4)
        const dayOfWeek = (daysSinceEpoch + 4) % 7;
        
        // Check if it's Thu-Sat 6-9PM
        if ((dayOfWeek === 4 || dayOfWeek === 5 || dayOfWeek === 6) && hours >= 18 && hours < 21) {
          await client.query(`
            INSERT INTO pizza_points (driver_id, event_type, points, event_time, delivery_id, block_id, claim_id, metadata)
            VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
          `, [
            completedDelivery.driver_id,
            'rush_hour_delivery',
            20,
            deliveryLogId,
            completedDelivery.block_id,
            completedDelivery.claim_id,
            JSON.stringify({
              day_of_week: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek],
              hour: hours,
              store_timezone: time_zone_code,
              store_local_time: new Date(storeLocalTimeMs).toISOString(),
              utc_time: deliveryDateUTC.toISOString(),
              offset_minutes: offsetMinutes,
              is_peak: true
            })
          ]);
          pizzaPoints += 20;
          console.log(`🔥 Awarded 20 PP rush hour bonus for ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek]} at ${hours}:00 store time`);
        }
      }
    }

    // TODO: Check for achievements after awarding points
    // await checkAndAwardBadges(client, completedDelivery.driver_id);
    // Note: You'll need to either import this function or implement badge checking later
    
    await client.query('COMMIT');
    
    // Format the response
    res.json({
      success: true,
      delivery: {
        delivery_log_id: completedDelivery.delivery_id,
        driver_id: completedDelivery.driver_id,
        order_number: completedDelivery.order_number,
        order_total: parseFloat(completedDelivery.order_total || 0),
        customer_name: completedDelivery.customer_name,
        slice_number: completedDelivery.slice_number,
        total_slices: completedDelivery.total_slices,
        order_type: completedDelivery.order_type,
        payment_status: completedDelivery.payment_status,
        order_time: completedDelivery.order_time,
        order_date: completedDelivery.order_date,
        phone_number: completedDelivery.phone_number,
        store_id: completedDelivery.store_id,
        delivery_photo_url: completedDelivery.delivery_photo_url,
        ocr_text: completedDelivery.ocr_text,
        ocr_status: completedDelivery.ocr_status,
        created_at: completedDelivery.created_at,
        completed_at: completedDelivery.completed_at,
        device_created_time: completedDelivery.device_created_time,
        device_completed_time: completedDelivery.device_completed_time,
        delivery_started_at: completedDelivery.delivery_started_at,
        delivery_completed_at: completedDelivery.delivery_completed_at,
        delivery_status: completedDelivery.delivery_status,
        block_id: completedDelivery.block_id,
        claim_id: completedDelivery.claim_id,
        duration_seconds: durationSeconds,
        pizza_points: pizzaPoints
      },
      message: `Delivery completed! You earned ${pizzaPoints} Pizza Points!`
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error completing delivery:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to complete delivery' 
    });
  } finally {
    client.release();
  }
};

// Get delivery logs for a driver or claim
exports.getDeliveryLogs = async (req, res) => {
  try {
    const { driver_id, claim_id, block_id } = req.query;
    
    let query = 'SELECT * FROM delivery_logs WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (driver_id) {
      query += ` AND driver_id = $${paramIndex}`;
      params.push(driver_id);
      paramIndex++;
    }
    
    if (claim_id) {
      query += ` AND claim_id = $${paramIndex}`;
      params.push(claim_id);
      paramIndex++;
    }
    
    if (block_id) {
      query += ` AND block_id = $${paramIndex}`;
      params.push(block_id);
      paramIndex++;
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      deliveries: result.rows
    });
  } catch (error) {
    console.error('Error fetching delivery logs:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch delivery logs' 
    });
  }
};