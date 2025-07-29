// FLEX-BACKEND/routes/blocks.js
const express = require('express');
const router = express.Router();
const blockController = require('../controllers/blockController');

router.get('/driver/available-blocks', blockController.getAvailableBlocks);
router.get('/driver/claimed-blocks', blockController.getClaimedBlocks);
router.post('/claim', blockController.claimBlock);
router.post('/unclaim', blockController.unclaimBlock);
// Removed: router.post('/update-expired', blockController.updateExpiredBlocks);

// In your routes file (likely routes/blocks.js or routes/index.js)
const { upload } = require('../config/cloudinary');

// Check-in with face photo upload
router.post('/blocks/:block_id/check-in', upload.single('face_photo'), blockController.checkInBlock);

// Get check-in status (no upload needed)
router.get('/blocks/:block_id/check-in-status', blockController.getCheckInStatus);

// Optional: Add the reference photo upload route if you want drivers to upload reference photos
router.post('/drivers/reference-photo', upload.single('photo'), blockController.uploadDriverReferencePhoto);

module.exports = router;