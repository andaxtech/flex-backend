// routes/driver-signup.js
const express = require('express');
const { uploadToGCS, getSignedUrl } = require('../utils/gcsStorage');
const router = express.Router();
const multer = require('multer');
const ocrController = require('../controllers/ocrController');
const pool = require('../db'); // Add this line after other requires
const { encrypt, hash } = require('../utils/encryption');
const { validateDriverSignup, sanitizeDate } = require('../utils/validation');
const validator = require('validator'); // npm install validator

// Configure multer properly
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    fieldSize: 25 * 1024 * 1024, // 25MB limit for field values (base64 strings)
    fields: 10,
    parts: 10
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
      const { compareFaces } = require('../utils/faceComparison');
      
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
  const client = await pool.connect();
  
  console.log('\n========================================');
  console.log('[SIGNUP] Driver signup called at:', new Date().toISOString());
  console.log('[SIGNUP] Request body keys:', Object.keys(req.body));
  
  try {
    const driverData = req.body;

    // Comprehensive validation
    const validation = validateDriverSignup(driverData);

    // Additional insurance state validation
if (!driverData.insurance_state || !driverData.insurance_state.match(/^[A-Z]{2}$/)) {
  validation.warnings = validation.warnings || [];
  validation.warnings.push('Insurance state missing or invalid - will use driver license state');
}
    
    if (!validation.isValid) {
      console.log('[SIGNUP] Validation failed:', validation.errors);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors: validation.errors,
        warnings: validation.warnings
      });
    }
    
    // Log warnings but don't block
    if (validation.warnings.length > 0) {
      console.log('[SIGNUP] Warnings:', validation.warnings);
    }

    // Additional data quality checks
    const dataQualityIssues = [];
    
    // Check if OCR might have failed
    if (driverData.first_name === driverData.last_name) {
      dataQualityIssues.push('First and last name are identical');
    }
    
    // Check for test data
    const testDataPatterns = ['test', 'demo', 'sample', 'xxx', '123456'];
    const fieldsToCheck = ['first_name', 'last_name', 'email', 'driver_license_number'];
    
    fieldsToCheck.forEach(field => {
      if (driverData[field] && testDataPatterns.some(pattern => 
        driverData[field].toLowerCase().includes(pattern))) {
        dataQualityIssues.push(`${field} appears to contain test data`);
      }
    });
    
    // If there are data quality issues, flag for manual review
    if (dataQualityIssues.length > 0) {
      driverData.requires_manual_review = true;
      driverData.verification_issues = [
        ...(driverData.verification_issues || []),
        ...dataQualityIssues
      ];
      console.log('[SIGNUP] Data quality issues found:', dataQualityIssues);
    }

    // Check for duplicate registration
    const existingDriver = await client.query(
      `SELECT d.driver_id, d.status, u.email 
       FROM drivers d 
       JOIN users u ON d.user_id = u.user_id 
       WHERE d.driver_license_number = $1 OR u.email = $2`,
      [driverData.driver_license_number, driverData.email]
    );
    
    if (existingDriver.rows.length > 0) {
      const existing = existingDriver.rows[0];
      console.log('[SIGNUP] Duplicate registration attempt:', existing);
      
      return res.status(400).json({
        success: false,
        error: 'Driver already registered',
        message: `A driver with this ${existing.email === driverData.email ? 'email' : 'license number'} already exists`,
        status: existing.status
      });
    }



       
    // Upload all images to GCS before starting transaction
console.log('[SIGNUP] Uploading images to GCS...');
const gcsUploads = {};

try {
  // Upload driver license photos
  if (driverData.driver_license_photo_front_url) {
    gcsUploads.driver_license_photo_front_gcs_path = await uploadToGCS(
      driverData.driver_license_photo_front_url, 
      'license_front'
    );
  }
  
  if (driverData.driver_license_photo_back_url) {
    gcsUploads.driver_license_photo_back_gcs_path = await uploadToGCS(
      driverData.driver_license_photo_back_url, 
      'license_back'
    );
  }
  
  // Upload profile/selfie photo
  if (driverData.profile_photo_url) {
    gcsUploads.profile_photo_gcs_path = await uploadToGCS(
      driverData.profile_photo_url, 
      'selfie'
    );
  }
  
  // Upload reference face photo
  if (driverData.reference_face_photo_url) {
    gcsUploads.reference_face_photo_gcs_path = await uploadToGCS(
      driverData.reference_face_photo_url, 
      'selfie'
    );
  }
  
  console.log('[SIGNUP] GCS uploads completed:', Object.keys(gcsUploads));
} catch (uploadError) {
  console.error('[SIGNUP] GCS upload failed:', uploadError);
  return res.status(500).json({
    success: false,
    error: 'Failed to upload documents',
    message: uploadError.message
  });
}


    // START TRANSACTION AFTER VALIDATION
    await client.query('BEGIN');

    // Encrypt sensitive fields with validation
    const encryptedData = {
      ...driverData,
      // Only encrypt if values exist
      document_discriminator_encrypted: driverData.document_discriminator_encrypted ? 
        encrypt(driverData.document_discriminator_encrypted) : null,
      residence_address_encrypted: driverData.residence_address_encrypted ? 
        encrypt(driverData.residence_address_encrypted) : null,
      registered_owner_names_encrypted: driverData.registered_owner_names_encrypted ? 
        encrypt(driverData.registered_owner_names_encrypted) : null,
      ca_title_number_encrypted: driverData.ca_title_number_encrypted ? 
        encrypt(driverData.ca_title_number_encrypted) : null,
      insured_names_encrypted: driverData.insured_names_encrypted ? 
        encrypt(driverData.insured_names_encrypted) : null,
      named_drivers_encrypted: driverData.named_drivers_encrypted ? 
        encrypt(driverData.named_drivers_encrypted) : null,
      ssn_encrypted: driverData.ssn ? encrypt(driverData.ssn) : null,
      ssn_hash: driverData.ssn ? hash(driverData.ssn) : null,
    };
    
    // Log important fields with UPDATED field names
    console.log('[SIGNUP] Driver name:', driverData.first_name, driverData.last_name);
    console.log('[SIGNUP] Email:', driverData.email);
    console.log('[SIGNUP] License number:', driverData.driver_license_number); // UPDATED
    console.log('[SIGNUP] Face match verified:', driverData.face_match_verified);
    console.log('[SIGNUP] Requires manual review:', driverData.requires_manual_review);
    
    // Step 1: Insert into users table (using email as username since we don't need separate usernames)
    // Step 1: Check if user already exists with this Clerk ID
let user_id;
const existingUser = await client.query(
  'SELECT user_id FROM users WHERE clerk_user_id = $1',
  [driverData.clerk_user_id]
);

if (existingUser.rows.length > 0) {
  // User already exists, use their ID
  user_id = existingUser.rows[0].user_id;
  console.log('[SIGNUP] Found existing user with ID:', user_id);
} else {
  // Create new user
  const userRes = await client.query(
    'INSERT INTO users (username, email, clerk_user_id, role, status, is_verified) VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id',
    [
      driverData.email,  // Use email as username
      driverData.email, 
      driverData.clerk_user_id, 
      'driver', 
      'pending', 
      true
    ]
  );
  user_id = userRes.rows[0].user_id;
  console.log('[SIGNUP] Created new user with ID:', user_id);
}
    console.log('[SIGNUP] Created user with ID:', user_id);
    
    // Step 2: Insert into drivers table
    const driverRes = await client.query(
      `INSERT INTO drivers (
        user_id,
        first_name,
        last_name,
        phone_number,
        email,
        driver_license_number,
        driver_license_expiration,
        birth_date,
        driver_license_state_issued,
        document_discriminator_encrypted,
        residence_address_encrypted,
        driver_license_photo_front_gcs_path,
        driver_license_photo_back_gcs_path,
        profile_photo_gcs_path,
        reference_face_photo_gcs_path,
        reference_face_uploaded_at,
        city,
        zip_code,
        status,
        email_verified,
        phone_verified,
        email_verified_at,
        phone_verified_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING driver_id`,
      [
        user_id,
        driverData.first_name,
        driverData.last_name,
        driverData.phone_number,
        driverData.email,
        driverData.driver_license_number,
        sanitizeDate(driverData.driver_license_expiration),
        sanitizeDate(driverData.birth_date),
        driverData.driver_license_state_issued,
        encryptedData.document_discriminator_encrypted,
        encryptedData.residence_address_encrypted,
        gcsUploads.driver_license_photo_front_gcs_path || null,  // Changed
        gcsUploads.driver_license_photo_back_gcs_path || null,   // Changed
        gcsUploads.profile_photo_gcs_path || null,               // Changed
        gcsUploads.reference_face_photo_gcs_path || null,        // Changed
        sanitizeDate(driverData.reference_face_uploaded_at),
        driverData.city,
        driverData.zip_code,
        driverData.requires_manual_review ? 'pending_review' : 'pending',
        true,
        true,
        new Date(),
        new Date()
      ]
    );
    const driver_id = driverRes.rows[0].driver_id;
    console.log('[SIGNUP] Created driver with ID:', driver_id);
    
    // Upload car images to GCS
const carGcsUploads = {};

try {
  if (driverData.vehicle_registration_photo_url) {
    carGcsUploads.vehicle_registration_photo_gcs_path = await uploadToGCS(
      driverData.vehicle_registration_photo_url,
      'registration'
    );
  }
  
  if (driverData.license_plate_photo_url) {
    carGcsUploads.license_plate_photo_gcs_path = await uploadToGCS(
      driverData.license_plate_photo_url,
      'plate'
    );
  }
  
  if (driverData.car_image_front) {
    carGcsUploads.car_image_front_gcs_path = await uploadToGCS(
      driverData.car_image_front,
      'vehicle_front'
    );
  }
  
  if (driverData.car_image_back) {
    carGcsUploads.car_image_back_gcs_path = await uploadToGCS(
      driverData.car_image_back,
      'vehicle_back'
    );
  }
  
  if (driverData.car_image_left) {
    carGcsUploads.car_image_left_gcs_path = await uploadToGCS(
      driverData.car_image_left,
      'vehicle_left'
    );
  }
  
  if (driverData.car_image_right) {
    carGcsUploads.car_image_right_gcs_path = await uploadToGCS(
      driverData.car_image_right,
      'vehicle_right'
    );
  }
  
  console.log('[SIGNUP] Car GCS uploads completed:', Object.keys(carGcsUploads));
} catch (uploadError) {
  await client.query('ROLLBACK');
  console.error('[SIGNUP] Car GCS upload failed:', uploadError);
  return res.status(500).json({
    success: false,
    error: 'Failed to upload vehicle documents',
    message: uploadError.message
  });
}


    // Step 3: Insert into car_details table
    const carRes = await client.query(
      `INSERT INTO car_details (
        driver_id,
        car_make,
        car_model,
        car_year,
        car_color,
        body_type,
        vin_number,
        license_plate,
        vehicle_registration_expiration,
        vehicle_registration_issued_date,
        registered_owner_names_encrypted,
        ca_title_number_encrypted,
        vehicle_registration_photo_gcs_path,
        license_plate_photo_gcs_path,
        car_image_front_gcs_path,
        car_image_back_gcs_path,
        car_image_left_gcs_path,
        car_image_right_gcs_path,
        vehicle_photos,
        inspection_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING car_id`,
      [
        driver_id,
        driverData.car_make,
        driverData.car_model,
        driverData.car_year,
        driverData.car_color,
        driverData.body_type,
        driverData.vin_number,
        driverData.license_plate,
        sanitizeDate(driverData.vehicle_registration_expiration || driverData.registration_expiration),
        sanitizeDate(driverData.registration_issued_date || driverData.vehicle_registration_issued_date),
        encryptedData.registered_owner_names_encrypted,
        encryptedData.ca_title_number_encrypted,
        carGcsUploads.vehicle_registration_photo_gcs_path || null,  // Changed
        carGcsUploads.license_plate_photo_gcs_path || null,         // Changed
        carGcsUploads.car_image_front_gcs_path || null,             // Changed
        carGcsUploads.car_image_back_gcs_path || null,              // Changed
        carGcsUploads.car_image_left_gcs_path || null,              // Changed
        carGcsUploads.car_image_right_gcs_path || null,             // Changed
        driverData.vehicle_photos || '[]',
        driverData.inspection_status || 'pending'
      ]
    );
    const car_id = carRes.rows[0].car_id;
    console.log('[SIGNUP] Created car details with ID:', car_id);
    
    // Upload insurance images to GCS
const insuranceGcsUploads = {};

try {
  if (driverData.insurance_card_photo_url) {
    insuranceGcsUploads.insurance_card_photo_gcs_path = await uploadToGCS(
      driverData.insurance_card_photo_url,
      'insurance'
    );
  }
  
  if (driverData.additional_document_url) {
    insuranceGcsUploads.additional_document_gcs_path = await uploadToGCS(
      driverData.additional_document_url,
      'insurance'
    );
  }
  
  console.log('[SIGNUP] Insurance GCS uploads completed:', Object.keys(insuranceGcsUploads));
} catch (uploadError) {
  await client.query('ROLLBACK');
  console.error('[SIGNUP] Insurance GCS upload failed:', uploadError);
  return res.status(500).json({
    success: false,
    error: 'Failed to upload insurance documents',
    message: uploadError.message
  });
}

   // Step 4: Insert into insurance_details table
await client.query(
  `INSERT INTO insurance_details (
    driver_id,
    car_id,
    insurance_provider,
    insurance_policy_number,
    policy_start_date,
    policy_end_date,
    insured_names_encrypted,
    named_drivers_encrypted,
    insurance_state,
    insurer_contact_info,
    insurance_card_photo_gcs_path,
    insurance_verification_issues,
    insurance_explanation,
    additional_document_gcs_path
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
  [
    driver_id,
    car_id,
    driverData.insurance_provider,
    driverData.insurance_policy_number,
    sanitizeDate(driverData.policy_start_date),
    sanitizeDate(driverData.policy_end_date),
    encryptedData.insured_names_encrypted,
    encryptedData.named_drivers_encrypted,
    (driverData.insurance_state && driverData.insurance_state.match(/^[A-Z]{2}$/))
      ? driverData.insurance_state
      : driverData.driver_license_state_issued || 'CA',
    driverData.insurer_contact_info,
    insuranceGcsUploads.insurance_card_photo_gcs_path || null,     // Changed
    JSON.stringify(driverData.insurance_verification_issues || []),
    driverData.insurance_explanation,
    insuranceGcsUploads.additional_document_gcs_path || null       // Changed
  ]
);
    console.log('[SIGNUP] Created insurance details');
    
    // Step 5: Insert into background_checks table
    await client.query(
      `INSERT INTO background_checks (
        driver_id,
        ssn_encrypted,
        work_authorization,
        criminal_consent,
        driving_consent,
        face_match_verified,
        face_match_confidence,
        face_match_issues,
        requires_manual_review,
        verification_issues,
        check_status,
        check_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        driver_id,
    encryptedData.ssn_encrypted,
        driverData.work_authorization,
        driverData.criminal_consent,
        driverData.driving_consent,
        driverData.face_match_verified,
        driverData.face_match_confidence,
        JSON.stringify(driverData.face_match_issues || []),
        driverData.requires_manual_review,
        JSON.stringify(driverData.verification_issues || []),
        'pending',
        new Date()
      ]
    );
    console.log('[SIGNUP] Created background check record');
    
    await client.query('COMMIT');
    
    console.log('[SIGNUP] SUCCESS - Driver registered with ID:', driver_id);
    console.log('========================================\n');
    
    res.status(201).json({
      success: true,
      message: 'Driver registered successfully',
      driver_id: driver_id,
      user_id: user_id,
      warnings: validation.warnings,
      requires_review: driverData.requires_manual_review
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[SIGNUP] ERROR:', error);
    console.error('[SIGNUP] Error detail:', error.detail);
    console.error('[SIGNUP] Error stack:', error.stack);
    console.log('========================================\n');
    
    res.status(500).json({
      success: false,
      error: 'Failed to register driver',
      message: error.message,
      detail: error.detail
    });
  } finally {
    client.release();
  }
});

// Debug middleware to log all requests to these routes
router.use((req, res, next) => {
  console.log(`[ROUTER] ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Test endpoint to verify GCS connection
router.get('/test-gcs', async (req, res) => {
  try {
    const { bucket } = require('../config/gcsConfig');
    const [files] = await bucket.getFiles({ maxResults: 5 });
    
    res.json({ 
      success: true, 
      message: 'GCS connected successfully',
      bucketName: process.env.GCS_BUCKET_NAME,
      filesCount: files.length,
      files: files.map(f => f.name)
    });
  } catch (error) {
    console.error('GCS test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Test endpoint to get a signed URL
router.get('/test-signed-url/:gcsPath', async (req, res) => {
  try {
    const { getSignedUrl } = require('../utils/gcsStorage');
    const signedUrl = await getSignedUrl(req.params.gcsPath);
    
    res.json({ 
      success: true, 
      signedUrl: signedUrl
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// View image endpoint with debugging
router.get('/view-image', async (req, res) => {
  try {
    const { path } = req.query;
    if (!path) {
      return res.status(400).json({ error: 'Path parameter required' });
    }
    
    console.log('[VIEW-IMAGE] Requesting path:', path);
    
    const { getSignedUrl } = require('../utils/gcsStorage');
    const signedUrl = await getSignedUrl(path);
    
    console.log('[VIEW-IMAGE] Generated signed URL:', signedUrl);
    
    // Try to verify the file exists first
    const { bucket } = require('../config/gcsConfig');
    const file = bucket.file(path);
    const [exists] = await file.exists();
    
    if (!exists) {
      return res.status(404).json({ 
        error: 'File not found in GCS',
        path: path 
      });
    }
    
    
    // Return HTML with the image
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Image Viewer</title>
          <style>
            body {
              margin: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: #f0f0f0;
              font-family: Arial, sans-serif;
            }
            .container {
              text-align: center;
              padding: 20px;
            }
            img {
              max-width: 90%;
              max-height: 80vh;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
              border-radius: 8px;
            }
            .path {
              margin-top: 10px;
              font-size: 12px;
              color: #666;
              word-break: break-all;
            }
            .error {
              color: red;
              padding: 20px;
              background: #ffe0e0;
              border-radius: 8px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <img src="${signedUrl}" alt="Document" onerror="this.style.display='none'; document.getElementById('error').style.display='block';" />
            <div id="error" style="display:none;" class="error">
              Failed to load image. The signed URL may have expired or the file may not exist.
            </div>
            <div class="path">Path: ${path}</div>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('[VIEW-IMAGE] Error:', error);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
});

// List all images for a driver
router.get('/driver-images/:driverId', async (req, res) => {
  try {
    const driverId = req.params.driverId;
    
    // Get all image paths for this driver
    const query = `
      SELECT 
        d.driver_id,
        d.first_name,
        d.last_name,
        d.driver_license_photo_front_gcs_path,
        d.driver_license_photo_back_gcs_path,
        d.profile_photo_gcs_path,
        d.reference_face_photo_gcs_path,
        c.vehicle_registration_photo_gcs_path,
        c.license_plate_photo_gcs_path,
        c.car_image_front_gcs_path,
        c.car_image_back_gcs_path,
        c.car_image_left_gcs_path,
        c.car_image_right_gcs_path,
        i.insurance_card_photo_gcs_path,
        i.additional_document_gcs_path
      FROM drivers d
      LEFT JOIN car_details c ON d.driver_id = c.driver_id
      LEFT JOIN insurance_details i ON d.driver_id = i.driver_id
      WHERE d.driver_id = $1
    `;
    
    const result = await pool.query(query, [driverId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const driver = result.rows[0];
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    // Build HTML with all images
    let html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Driver Images - ${driver.first_name} ${driver.last_name}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 20px;
              background: #f5f5f5;
            }
            h1 {
              color: #333;
            }
            .image-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
              gap: 20px;
              margin-top: 20px;
            }
            .image-card {
              background: white;
              border-radius: 8px;
              padding: 15px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .image-card h3 {
              margin: 0 0 10px 0;
              color: #2563eb;
            }
            .image-card img {
              width: 100%;
              height: 200px;
              object-fit: contain;
              border: 1px solid #eee;
              border-radius: 4px;
              cursor: pointer;
            }
            .no-image {
              width: 100%;
              height: 200px;
              display: flex;
              align-items: center;
              justify-content: center;
              background: #f0f0f0;
              border: 1px dashed #ccc;
              border-radius: 4px;
              color: #999;
            }
          </style>
        </head>
        <body>
          <h1>Driver Images: ${driver.first_name} ${driver.last_name} (ID: ${driver.driver_id})</h1>
          <div class="image-grid">
    `;
    
    const imageTypes = [
      { path: driver.driver_license_photo_front_gcs_path, label: 'License Front' },
      { path: driver.driver_license_photo_back_gcs_path, label: 'License Back' },
      { path: driver.profile_photo_gcs_path, label: 'Profile Photo' },
      { path: driver.reference_face_photo_gcs_path, label: 'Reference Face' },
      { path: driver.vehicle_registration_photo_gcs_path, label: 'Vehicle Registration' },
      { path: driver.license_plate_photo_gcs_path, label: 'License Plate' },
      { path: driver.car_image_front_gcs_path, label: 'Car Front' },
      { path: driver.car_image_back_gcs_path, label: 'Car Back' },
      { path: driver.car_image_left_gcs_path, label: 'Car Left' },
      { path: driver.car_image_right_gcs_path, label: 'Car Right' },
      { path: driver.insurance_card_photo_gcs_path, label: 'Insurance Card' },
      { path: driver.additional_document_gcs_path, label: 'Additional Document' }
    ];
    
    for (const imgType of imageTypes) {
      html += `
        <div class="image-card">
          <h3>${imgType.label}</h3>
      `;
      
      if (imgType.path) {
        const viewUrl = `${baseUrl}/view-image?path=${encodeURIComponent(imgType.path)}`;
        html += `<img src="${viewUrl}" onclick="window.open('${viewUrl}', '_blank')" alt="${imgType.label}" />`;
      } else {
        html += `<div class="no-image">No image uploaded</div>`;
      }
      
      html += `</div>`;
    }
    
    html += `
          </div>
        </body>
      </html>
    `;
    
    res.send(html);
    
  } catch (error) {
    console.error('Error getting driver images:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export the router
module.exports = router;