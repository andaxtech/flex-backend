// FLEX-BACKEND/routes/drivers.js
const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');

// Get all active drivers
router.get('/drivers', driverController.getDrivers);

// Get driver by ID
router.get('/drivers/:id', driverController.getDriverById);

// Get driver by user ID
router.get('/drivers/user/:userId', driverController.getDriverByUserId);

// Get driver by Clerk ID
router.get('/drivers/clerk/:clerkId', driverController.getDriverByClerkId);

// Update driver status
router.put('/drivers/:id/status', driverController.updateDriverStatus);

// Get driver's car details
router.get('/drivers/:id/car', driverController.getDriverCarDetails);

// Get driver's insurance details
router.get('/drivers/:id/insurance', driverController.getDriverInsuranceDetails);

// Get driver's next block
router.get('/drivers/:id/next-block', driverController.getNextBlock);

// REMOVED the signup route - it's now handled in driver-signup.js
// router.post('/signup-driver', driverController.signupDriver); ← DELETED

module.exports = router;