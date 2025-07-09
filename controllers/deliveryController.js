// FLEX-BACKEND/controllers/deliveryController.js
const pool = require('../db');
const extractText = require('../utils/ocr');
const uploadImage = require('../utils/upload');

exports.startDelivery = async (req, res) => {
  const { driver_id } = req.body;
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
      INSERT INTO delivery_logs 
        (driver_id, order_number, order_total, customer_name, slice_number, total_slices, order_type, payment_status, order_time, order_date, phone_number, store_id, delivery_photo_url, ocr_text, ocr_status)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;

    const result = await pool.query(insertQuery, [
      driver_id,
      order_number,
      order_total,
      customer_name,
      slice_number,
      total_slices,
      order_type,
      payment_status,
      order_time,
      order_date,
      phone_number,
      store_id,
      imageUrl,
      JSON.stringify(ocrResult),
      'parsed'
    ]);

    res.json({ success: true, delivery: result.rows[0] });
  } catch (error) {
    console.error('❌ Delivery start failed:', error);
    res.status(500).json({ success: false, error: 'OCR failed or upload error' });
  }
};


