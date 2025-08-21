const { bucket } = require('../config/gcsConfig');
const crypto = require('crypto');

// Upload file to GCS from base64
async function uploadToGCS(base64Data, documentType) {
  try {
    // Remove data URL prefix if exists
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    
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