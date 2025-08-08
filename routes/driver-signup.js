// routes/driver-signup.js
const express = require('express'); // <-- ADD THIS LINE!
const router = express.Router();
const multer = require('multer');
const ocrController = require('../controllers/ocrController');

// Configure multer properly
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  }
});

// OCR route with controller
router.post('/api/ocr/extract-document', 
  upload.single('image'), 
  ocrController.extractDocument
);

// Your existing signup-driver endpoint (if you have one)
router.post('/signup-driver', async (req, res) => {
  try {
    const driverData = req.body;
    
    // Your existing driver signup logic here...
    
    res.json({
      success: true,
      message: 'Driver registered successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Export the router
module.exports = router;