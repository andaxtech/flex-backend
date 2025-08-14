const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();


const blockRoutes = require('./routes/blocks');
const deliveryRoutes = require('./routes/delivery');
const driverRoutes = require('./routes/drivers');
const trainingRoutes = require('./routes/training');
const driverSignupRoutes = require('./routes/driver-signup'); // NEW: Driver signup with OCR

// Import the cron job utilities
const { startCronJobs, runInitialCleanup } = require('./utils/cron');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // UPDATED: Increased limit for base64 images
app.use(express.urlencoded({ limit: '50mb', extended: true })); // UPDATED: Increased limit

// Request logger (moved up for better logging)
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.originalUrl}`);
  next();
});

// Route mounting
app.use('/api', blockRoutes);
app.use('/api', deliveryRoutes);
app.use('/api', driverRoutes);
app.use('/api/training', trainingRoutes);
app.use('/', driverSignupRoutes); // NEW: OCR routes - mounted at root to get /api/ocr/extract-document

// Health check
app.get('/', (req, res) => {
  res.send('🚀 Flex Backend is Running with Driver Training & OCR!');
});

// Training system health check
app.get('/api/health/training', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: '🎓 Driver Training System Active',
    timestamp: new Date().toISOString() 
  });
});

// OCR system health check
app.get('/api/health/ocr', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: '📸 OCR System Active',
    endpoints: ['/api/ocr/extract-document'],
    timestamp: new Date().toISOString() 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`🎓 Driver Training System: ACTIVE`);
  console.log(`📸 OCR System: ACTIVE`);
  console.log(`📚 Training API: http://localhost:${PORT}/api/training`);
  console.log(`🔍 OCR API: http://localhost:${PORT}/api/ocr/extract-document`);
  
  // Start the cron jobs
  startCronJobs();
  
  // Run initial cleanup
  await runInitialCleanup();
});