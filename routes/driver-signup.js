// routes/driver-signup.js (with controller)
const router = express.Router();
const multer = require('multer');
const ocrController = require('../controllers/ocrController');

const upload = multer({ /* ... config ... */ });

// Cleaner route with controller
router.post('/api/ocr/extract-document', 
  upload.single('image'), 
  ocrController.extractDocument
);