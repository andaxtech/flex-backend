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

// Add face comparison endpoint with debugging
router.post('/api/ocr/compare-faces', 
  upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'licensePhoto', maxCount: 1 }
  ]), 
  async (req, res) => {
    console.log('\n========================================');
    console.log('[FACE MATCH] Endpoint called at:', new Date().toISOString());
    console.log('[FACE MATCH] Request method:', req.method);
    console.log('[FACE MATCH] Request headers:', JSON.stringify(req.headers, null, 2));
    console.log('[FACE MATCH] Request body keys:', Object.keys(req.body));
    console.log('[FACE MATCH] Request files:', req.files);
    console.log('[FACE MATCH] Body size:', JSON.stringify(req.body).length, 'bytes');
    
    try {
      const { compareFaces } = require('../utils/documentOCR');
      
      // Get photos from request body (they come as base64 strings from frontend)
      const profilePhoto = req.body.profilePhoto;
      const licensePhoto = req.body.licensePhoto;
      
      console.log('[FACE MATCH] Profile photo exists:', !!profilePhoto);
      console.log('[FACE MATCH] Profile photo length:', profilePhoto?.length || 0);
      console.log('[FACE MATCH] Profile photo preview:', profilePhoto?.substring(0, 50) + '...');
      
      console.log('[FACE MATCH] License photo exists:', !!licensePhoto);
      console.log('[FACE MATCH] License photo length:', licensePhoto?.length || 0);
      console.log('[FACE MATCH] License photo preview:', licensePhoto?.substring(0, 50) + '...');
      
      if (!profilePhoto || !licensePhoto) {
        console.log('[FACE MATCH] ERROR - Missing photos');
        console.log('[FACE MATCH] Profile photo missing:', !profilePhoto);
        console.log('[FACE MATCH] License photo missing:', !licensePhoto);
        
        return res.status(400).json({
          success: false,
          error: 'Both profile and license photos are required',
          debug: {
            profilePhotoReceived: !!profilePhoto,
            licensePhotoReceived: !!licensePhoto,
            bodyKeys: Object.keys(req.body)
          }
        });
      }
      
      // Validate base64 format
      const profileValid = profilePhoto.startsWith('data:image/') || profilePhoto.startsWith('http');
      const licenseValid = licensePhoto.startsWith('data:image/') || licensePhoto.startsWith('http');
      
      console.log('[FACE MATCH] Profile photo valid format:', profileValid);
      console.log('[FACE MATCH] License photo valid format:', licenseValid);
      
      if (!profileValid || !licenseValid) {
        console.log('[FACE MATCH] ERROR - Invalid photo format');
        return res.status(400).json({
          success: false,
          error: 'Invalid photo format. Expected base64 or URL',
          debug: {
            profileFormat: profilePhoto.substring(0, 30),
            licenseFormat: licensePhoto.substring(0, 30)
          }
        });
      }
      
      // Call the compareFaces function
      console.log('[FACE MATCH] Calling compareFaces function...');
      const startTime = Date.now();
      
      const result = await compareFaces(profilePhoto, licensePhoto);
      
      const endTime = Date.now();
      console.log('[FACE MATCH] Face comparison took:', endTime - startTime, 'ms');
      console.log('[FACE MATCH] Comparison result:', JSON.stringify(result, null, 2));
      
      if (!result) {
        console.log('[FACE MATCH] ERROR - Comparison returned null');
        return res.status(500).json({
          success: false,
          error: 'Face comparison failed - null result'
        });
      }
      
      // Log the actual comparison results
      console.log('[FACE MATCH] is_real_person:', result.is_real_person);
      console.log('[FACE MATCH] is_same_person:', result.is_same_person);
      console.log('[FACE MATCH] match_confidence:', result.match_confidence);
      console.log('[FACE MATCH] issues:', result.issues);
      console.log('[FACE MATCH] details:', result.details);
      
      console.log('[FACE MATCH] SUCCESS - Returning result');
      console.log('========================================\n');
      
      res.json({
        success: true,
        ...result,
        debug: {
          processingTime: endTime - startTime,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('[FACE MATCH] ERROR - Exception caught:', error);
      console.error('[FACE MATCH] Error name:', error.name);
      console.error('[FACE MATCH] Error message:', error.message);
      console.error('[FACE MATCH] Error stack:', error.stack);
      console.log('========================================\n');
      
      res.status(500).json({
        success: false,
        error: 'Failed to compare faces',
        message: error.message,
        debug: {
          errorType: error.name,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// Your existing signup-driver endpoint with debugging
router.post('/signup-driver', async (req, res) => {
  console.log('\n========================================');
  console.log('[SIGNUP] Driver signup called at:', new Date().toISOString());
  console.log('[SIGNUP] Request body keys:', Object.keys(req.body));
  
  try {
    const driverData = req.body;
    
    // Log important fields
    console.log('[SIGNUP] Driver name:', driverData.first_name, driverData.last_name);
    console.log('[SIGNUP] Email:', driverData.email);
    console.log('[SIGNUP] License number:', driverData.license_number);
    console.log('[SIGNUP] Face match verified:', driverData.face_match_verified);
    console.log('[SIGNUP] Requires manual review:', driverData.requires_manual_review);
    
    // Your existing driver signup logic here...
    // This is where you'd save to database, etc.
    
    console.log('[SIGNUP] SUCCESS - Driver registered');
    console.log('========================================\n');
    
    res.json({
      success: true,
      message: 'Driver registered successfully',
      data: driverData
    });
  } catch (error) {
    console.error('[SIGNUP] ERROR:', error);
    console.error('[SIGNUP] Error stack:', error.stack);
    console.log('========================================\n');
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug middleware to log all requests to these routes
router.use((req, res, next) => {
  console.log(`[ROUTER] ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Export the router
module.exports = router;