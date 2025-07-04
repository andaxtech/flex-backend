const express = require('express');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const extractText = require('../utils/ocr');
const uploadImage = require('../utils/upload');
const pool = require('../db');

const router = express.Router();

router.post('/start-delivery', upload.single('photo'), async (req, res) => {
  const { driver_id } = req.body;
  const filePath = req.file.path;

  try {
    const imageUrl = await uploadImage(filePath);
    const ocrResult = await extractText(imageUrl);

    let orderNumber = null;
    let orderTotal = null;
    let customerName = null;

    if (typeof ocrResult === 'object') {
      orderNumber = ocrResult.order_number || null;
      orderTotal = ocrResult.order_total || null;
      customerName = ocrResult.customer_name || null;
    }

    const result = await pool.query(
      `INSERT INTO delivery_logs 
        (driver_id, order_number, order_total, customer_name, store_id, delivery_photo_url, ocr_text, ocr_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'parsed')
       RETURNING *`,
      [driver_id, orderNumber, orderTotal, customerName, null, imageUrl, JSON.stringify(ocrResult)]
    );

    res.json({ success: true, delivery: result.rows[0] });
  } catch (error) {
    console.error('❌ Delivery start failed:', error);
    res.status(500).json({ success: false, error: 'OCR failed or upload error' });
  }
});

module.exports = router;
