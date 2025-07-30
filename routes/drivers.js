// FLEX-BACKEND/routes/drivers.js
const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');

router.get('/drivers', driverController.getDrivers);
router.post('/signup-driver', driverController.signupDriver);
router.get('/drivers/:id', driverController.getDriverById);
router.get('/drivers/:id/next-block', driverController.getNextBlock);

module.exports = router;
