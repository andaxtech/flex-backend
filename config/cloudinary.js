// config/cloudinary.js
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.dyqawnoxj,
  api_key: process.env.312896732184767,
  api_secret: process.env.PHanRLll2Xu-x-KwWNft-Pg4Fks
});

// Use memory storage instead of cloudinary storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

module.exports = { cloudinary, upload };