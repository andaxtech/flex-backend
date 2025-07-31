// FLEX-BACKEND/controllers/deliveryController.js
const pool = require('../db');
const extractText = require('../utils/ocr');
const uploadImage = require('../utils/upload');

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
    delivery_started_at,  -- Add this
    delivery_status,      -- Add this
    created_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 
    $11, $12, $13, $14, $15, $16, $17, $18, 
    NOW(),                -- delivery_started_at
    'in_progress',        -- delivery_status
    NOW()
  ) RETURNING *
`;

    const result = await pool.query(insertQuery, [
      driver_id,
      block_id || null,  // Add block_id
      claim_id || null,  // Add claim_id
      order_number,
      order_total ? parseFloat(order_total) : null,
      customer_name,
      slice_number ? parseInt(slice_number) : null,
      total_slices ? parseInt(total_slices) : null,
      order_type,
      payment_status,
      order_time,
      order_date,
      phone_number,
      store_id,
      imageUrl,
      JSON.stringify(ocrResult),
      'parsed',
      device_local_time || null  // Add device_local_time
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
  // Add this function to your deliveryController.js

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
      WHERE delivery_log_id = $1
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
    
    // Calculate Pizza Points
    let pizzaPoints = 5; // Default participation points
    if (durationSeconds <= 900) pizzaPoints = 50;      // 15 min or less
    else if (durationSeconds <= 1200) pizzaPoints = 30; // 20 min or less
    else if (durationSeconds <= 1500) pizzaPoints = 20; // 25 min or less
    else if (durationSeconds <= 1800) pizzaPoints = 10; // 30 min or less
    
    // Update driver's pizza points (if you have a pizza_points table)
    // await client.query(
    //   'INSERT INTO pizza_points (driver_id, delivery_log_id, points, earned_at) VALUES ($1, $2, $3, NOW())',
    //   [completedDelivery.driver_id, deliveryLogId, pizzaPoints]
    // );
    
    await client.query('COMMIT');
    
    // Format the response
    res.json({
      success: true,
      delivery: {
        delivery_log_id: completedDelivery.delivery_log_id,
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
