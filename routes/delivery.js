// FLEX-BACKEND/routes/delivery.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const deliveryController = require('../controllers/deliveryController');

const upload = multer({ dest: 'uploads/' });

// Start a new delivery
router.post('/start-delivery', upload.single('photo'), deliveryController.startDelivery);

// Complete a delivery
router.post('/deliveries/:deliveryLogId/complete', deliveryController.completeDelivery);

// Get delivery logs for a claim
router.get('/delivery-logs', deliveryController.getDeliveryLogs);

module.exports = router;