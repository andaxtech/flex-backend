const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const fs = require('fs/promises');

async function uploadImage(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'deliveries',
    });

    // Optionally delete local file after upload
    await fs.unlink(filePath).catch(() => {}); // ignore deletion errors

    return result.secure_url;
  } catch (err) {
    console.error('❌ Cloudinary upload failed:', err);
    throw new Error('Image upload failed');
  }
}

module.exports = uploadImage;
