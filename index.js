const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { initializeWebSocket } = require('./websocket/socketServer');

dotenv.config();

const blockRoutes = require('./routes/blocks');
const deliveryRoutes = require('./routes/delivery');
const driverRoutes = require('./routes/drivers');
const trainingRoutes = require('./routes/training');
const driverSignupRoutes = require('./routes/driver-signup');

// Import the cron job utilities
const { startCronJobs, runInitialCleanup } = require('./utils/cron');

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket
const { 
  io, 
  emitBlockClaimed, 
  emitBlockReleased, 
  emitNewBlockAvailable,
  emitScheduleUpdated,
  emitBlockCancelled,
  emitBlockModified,
  emitCheckInStatusChanged,
  getConnectionStats 
} = initializeWebSocket(server);

// Make WebSocket utilities available globally
global.socketIO = {
  io,
  emitBlockClaimed,
  emitBlockReleased,
  emitNewBlockAvailable,
  emitScheduleUpdated,
  emitBlockCancelled,
  emitBlockModified,
  emitCheckInStatusChanged
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request logger
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.originalUrl}`);
  next();
});

// Route mounting
app.use('/api', blockRoutes);
app.use('/api', deliveryRoutes);
app.use('/api', driverRoutes);
app.use('/api/training', trainingRoutes);
app.use('/', driverSignupRoutes);

// Health check
app.get('/', (req, res) => {
  res.send('🚀 Flex Backend is Running with Driver Training, OCR & WebSocket!');
});

// WebSocket health check
app.get('/api/health/websocket', (req, res) => {
  const stats = getConnectionStats();
  res.json({ 
    status: 'OK', 
    message: '🔌 WebSocket System Active',
    stats: stats,
    timestamp: new Date().toISOString() 
  });
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

// Start server (using server instead of app)
server.listen(PORT, async () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`🔌 WebSocket Server: ACTIVE`);
  console.log(`🎓 Driver Training System: ACTIVE`);
  console.log(`📸 OCR System: ACTIVE`);
  console.log(`📚 Training API: http://localhost:${PORT}/api/training`);
  console.log(`🔍 OCR API: http://localhost:${PORT}/api/ocr/extract-document`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  
  // Start the cron jobs
  startCronJobs();
  
  // Run initial cleanup
  await runInitialCleanup();
});