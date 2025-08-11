// routes/driver-signup.js
const express = require('express');
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

// Add face comparison endpoint
router.post('/api/ocr/compare-faces', 
  upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'licensePhoto', maxCount: 1 }
  ]), 
  async (req, res) => {
    try {
      const { compareFaces } = require('../utils/documentOCR');
      
      // Get photos from request body (they come as base64 strings from frontend)
      const profilePhoto = req.body.profilePhoto;
      const licensePhoto = req.body.licensePhoto;
      
      if (!profilePhoto || !licensePhoto) {
        return res.status(400).json({
          success: false,
          error: 'Both profile and license photos are required'
        });
      }
      
      // Call the compareFaces function
      const result = await compareFaces(profilePhoto, licensePhoto);
      
      if (!result) {
        return res.status(500).json({
          success: false,
          error: 'Face comparison failed'
        });
      }
      
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('Face comparison error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to compare faces',
        message: error.message
      });
    }
  }
);

// Your existing signup-driver endpoint
router.post('/signup-driver', async (req, res) => {
  try {
    const driverData = req.body;
    
    // Your existing driver signup logic here...
    // This is where you'd save to database, etc.
    
    res.json({
      success: true,
      message: 'Driver registered successfully',
      data: driverData
    });
  } catch (error) {
    console.error('Driver signup error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Export the router
module.exports = router;