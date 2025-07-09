const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const authRoutes = require('./routes/auth');
const blockRoutes = require('./routes/blocks');
const deliveryRoutes = require('./routes/delivery');
const driverRoutes = require('./routes/drivers');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Route mounting
app.use('/api', authRoutes);
app.use('/api', blockRoutes);
app.use('/api', deliveryRoutes);
app.use('/api', driverRoutes);

// Health check
app.get('/', (req, res) => {
  res.send('🚀 Flex Backend is Running!');
});

// Request logger
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.originalUrl}`);
  next();
});

// Global error handler (optional improvement)
app.use((err, req, res, next) => {
  console.error('❌ Unhandled Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
