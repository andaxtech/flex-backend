const express = require('express');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const extractText = require('../utils/ocr');
const uploadImage = require('../utils/upload');
const pool = require('../db'); // your PostgreSQL connection

const router = express.Router();

router.post('/start-delivery', upload.single('photo'), async (req, res) => {
  const { driver_id } = req.body;
  const filePath = req.file.path;

  try {
    const imageUrl = await uploadImage(filePath);
    const ocrText = await extractText(imageUrl);

    const orderNumber = (ocrText.match(/\d{6}/) || [])[0] || null;
    const orderTotal = (ocrText.match(/\d+\.\d{2}/) || [])[0] || null;
    const customerName = (ocrText.match(/[A-Z]{2,}\s?[A-Z]*/g) || [])[0] || null;

    const result = await pool.query(
      `INSERT INTO delivery_logs 
        (driver_id, order_number, order_total, customer_name, store_id, delivery_photo_url, ocr_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [driver_id, orderNumber, orderTotal, customerName, null, imageUrl, ocrText]
    );

    res.json({ success: true, delivery: result.rows[0] });
  } catch (error) {
    console.error('❌ Delivery start failed:', error);
    res.status(500).json({ success: false, error: 'OCR failed or upload error' });
  }
});

module.exports = router;
