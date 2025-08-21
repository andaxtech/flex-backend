const { Storage } = require('@google-cloud/storage');

let storage;

if (process.env.GCS_KEY_BASE64) {
  // Production (Railway) - decode base64 key
  const keyJson = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
  const keyData = JSON.parse(keyJson);
  
  storage = new Storage({
    projectId: process.env.GCS_PROJECT_ID,
    credentials: keyData
  });
} else {
  // Local development - use key file
  storage = new Storage({
    projectId: process.env.GCS_PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
  });
}

const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

module.exports = { storage, bucket };