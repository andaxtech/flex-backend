// FLEX-BACKEND/routes/blocks.js
const express = require('express');
const router = express.Router();
const blockController = require('../controllers/blockController');

router.get('/driver/available-blocks', blockController.getAvailableBlocks);
router.get('/driver/claimed-blocks', blockController.getClaimedBlocks);
router.post('/claim', blockController.claimBlock);
router.post('/unclaim', blockController.unclaimBlock);
router.post('/update-expired', blockController.updateExpiredBlocks);

module.exports = router;