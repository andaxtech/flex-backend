// FLEX-BACKEND/routes/delivery.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const deliveryController = require('../controllers/deliveryController');

const upload = multer({ dest: 'uploads/' });
router.post('/start-delivery', upload.single('photo'), deliveryController.startDelivery);

module.exports = router;