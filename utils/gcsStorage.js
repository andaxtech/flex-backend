const { bucket } = require('../config/gcsConfig');
const crypto = require('crypto');

// Upload file to GCS from base64
async function uploadToGCS(base64Data, documentType) {
  try {
    console.log(`[GCS Upload] Starting upload for ${documentType}`);
    console.log(`[GCS Upload] Input data length: ${base64Data?.length || 0}`);
    console.log(`[GCS Upload] First 100 chars: ${base64Data?.substring(0, 100)}`);
    
    // Check if it's a data URL or raw base64
    let base64 = base64Data;
    if (base64Data.startsWith('data:')) {
      // Extract base64 from data URL
      const matches = base64Data.match(/^data:image\/\w+;base64,(.+)$/);
      if (!matches || !matches[1]) {
        throw new Error('Invalid data URL format');
      }
      base64 = matches[1];
    }
    
    console.log(`[GCS Upload] Base64 length after extraction: ${base64.length}`);
    
                                  // Validate base64 string
                                if (!base64 || base64.length === 0) {
                                  throw new Error('Base64 string is empty');
                                }

                                // Remove any whitespace or newlines
                                base64 = base64.replace(/\s/g, '');

                                // Validate it's valid base64
                                if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
                                  throw new Error('Invalid base64 string');
                                }

                                // Create buffer from base64
                                const buffer = Buffer.from(base64, 'base64');
                                console.log(`[GCS Upload] Buffer size: ${buffer.length} bytes`);

                                // Verify buffer is valid
                                if (buffer.length === 0) {
                                  throw new Error('Empty buffer - no image data');
                                }

                                // Verify buffer is a valid image (minimum size check)
                                if (buffer.length < 100) {
                                  throw new Error('Buffer too small to be a valid image');
                                }
    
    // Determine folder path based on document type
    const folderPaths = {
      'license_front': process.env.GCS_LICENSE_FRONT_PATH,
      'license_back': process.env.GCS_LICENSE_BACK_PATH,
      'selfie': process.env.GCS_SELFIE_PATH,
      'registration': process.env.GCS_REGISTRATION_PATH,
      'insurance': process.env.GCS_INSURANCE_PATH,
      'plate': process.env.GCS_PLATE_PATH,
      'vehicle_front': process.env.GCS_VEHICLE_PHOTOS_PATH,
      'vehicle_back': process.env.GCS_VEHICLE_PHOTOS_PATH,
      'vehicle_left': process.env.GCS_VEHICLE_PHOTOS_PATH,
      'vehicle_right': process.env.GCS_VEHICLE_PHOTOS_PATH,
    };
    
    const folderPath = folderPaths[documentType] || 'misc/';
    
    // Create unique filename
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const fileName = `${documentType}_${timestamp}_${randomString}.jpg`;
    const filePath = `${folderPath}${fileName}`;
    
    // Create file reference
    const file = bucket.file(filePath);
    
    // Upload file
    await file.save(buffer, {
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'private, max-age=0'
      }
    });
    
    // Return the GCS path (not a URL)
    return filePath;
    
  } catch (error) {
    console.error('GCS upload error:', error);
    throw error;
  }
}

// Generate signed URL for viewing (when needed)
async function getSignedUrl(gcsPath, expirationMinutes = 60) {
  try {
    const file = bucket.file(gcsPath);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`File not found: ${gcsPath}`);
    }
    
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',  // Use v4 signing
      action: 'read',
      expires: Date.now() + expirationMinutes * 60 * 1000,
    });
    
    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
}

module.exports = {
  uploadToGCS,
  getSignedUrl
};