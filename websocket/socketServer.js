// FLEX-BACKEND/websocket/socketServer.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Store active connections
const activeConnections = new Map(); // driverId -> Set of socket IDs
const socketToDriver = new Map(); // socketId -> driverId

function initializeWebSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    // Railway specific: Allow websocket upgrades
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const driverId = socket.handshake.auth.driverId;
      
      if (!driverId) {
        return next(new Error('Authentication failed: No driver ID'));
      }

      // If you're using JWT, verify it here
      // const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      socket.driverId = parseInt(driverId);
      console.log(`🔌 Driver ${driverId} authenticating...`);
      next();
    } catch (err) {
      console.error('Socket authentication error:', err);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const driverId = socket.driverId;
    console.log(`✅ Driver ${driverId} connected (socket: ${socket.id})`);

    // Track connection
    if (!activeConnections.has(driverId)) {
      activeConnections.set(driverId, new Set());
    }
    activeConnections.get(driverId).add(socket.id);
    socketToDriver.set(socket.id, driverId);

    // Join driver-specific room
    socket.join(`driver-${driverId}`);
    
    // Join general blocks room
    socket.join('available-blocks');
    
    // Join schedule-specific room
    socket.join(`driver-${driverId}-schedule`);

    // Send initial connection confirmation
    socket.emit('connected', {
      message: 'Connected to real-time updates',
      driverId: driverId
    });

    // Handle block claim requests
    socket.on('claim-block', async (data) => {
      console.log(`🎯 Driver ${driverId} attempting to claim block ${data.blockId}`);
      
      // Emit to the specific driver that they're claiming
      socket.emit('claiming-block', { blockId: data.blockId });
      
      // Note: The actual claiming happens via HTTP API
      // This is just for real-time feedback
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`❌ Driver ${driverId} disconnected (socket: ${socket.id})`);
      
      // Clean up tracking
      const driverSockets = activeConnections.get(driverId);
      if (driverSockets) {
        driverSockets.delete(socket.id);
        if (driverSockets.size === 0) {
          activeConnections.delete(driverId);
        }
      }
      socketToDriver.delete(socket.id);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for driver ${driverId}:`, error);
    });

    // Handle location updates from driver
    socket.on('location-update', (data) => {
      const { claimId, blockId, location } = data;
      
      // Emit to managers watching this block/claim
      io.to(`block-${blockId}-tracking`).emit('driver-location', {
        driverId: driverId,
        claimId: claimId,
        blockId: blockId,
        location: location,
        timestamp: new Date().toISOString()
      });
      
      console.log(`📍 Location update from driver ${driverId} for block ${blockId}`);
    });

    // Handle manager joining block tracking room
    socket.on('track-block', (data) => {
      const { blockId } = data;
      socket.join(`block-${blockId}-tracking`);
      console.log(`👁️ Manager joined tracking for block ${blockId}`);
    });

    // Handle manager leaving block tracking room
    socket.on('untrack-block', (data) => {
      const { blockId } = data;
      socket.leave(`block-${blockId}-tracking`);
      console.log(`👁️ Manager left tracking for block ${blockId}`);
    });
  });
  

  // Utility functions to emit events
  const emitToAllDrivers = (event, data) => {
    io.to('available-blocks').emit(event, data);
  };

  const emitToDriver = (driverId, event, data) => {
    io.to(`driver-${driverId}`).emit(event, data);
  };

  const emitBlockClaimed = (blockId, claimedByDriverId) => {
    // Notify all drivers that a block was claimed
    io.to('available-blocks').emit('block-claimed', {
      blockId: blockId,
      claimedBy: claimedByDriverId,
      timestamp: new Date().toISOString()
    });
  };

  const emitBlockReleased = (blockId) => {
    // Notify all drivers that a block is available again
    io.to('available-blocks').emit('block-released', {
      blockId: blockId,
      timestamp: new Date().toISOString()
    });
  };

  const emitNewBlockAvailable = (block) => {
    // Notify all drivers about a new block
    io.to('available-blocks').emit('new-block', {
      block: block,
      timestamp: new Date().toISOString()
    });
  };

  // Schedule-specific event emitters
  const emitScheduleUpdated = (driverId, blockId, changes) => {
    io.to(`driver-${driverId}-schedule`).emit('schedule-updated', {
      blockId: blockId,
      changes: changes,
      timestamp: new Date().toISOString()
    });
  };

  const emitBlockCancelled = (driverId, blockId, reason) => {
    // Notify the specific driver
    io.to(`driver-${driverId}-schedule`).emit('block-cancelled', {
      blockId: blockId,
      reason: reason,
      timestamp: new Date().toISOString()
    });
    
    // Also notify all drivers that this block is available again
    emitBlockReleased(blockId);
  };

  const emitBlockModified = (driverId, blockId, modifications) => {
    io.to(`driver-${driverId}-schedule`).emit('block-modified', {
      blockId: blockId,
      modifications: modifications,
      timestamp: new Date().toISOString()
    });
  };

  const emitCheckInStatusChanged = (driverId, blockId, status, claimId) => {
    io.to(`driver-${driverId}-schedule`).emit('check-in-status-changed', {
      blockId: blockId,
      claimId: claimId,
      status: status,
      timestamp: new Date().toISOString()
    });
  };

  // Get connection stats
  const getConnectionStats = () => {
    return {
      totalConnections: socketToDriver.size,
      uniqueDrivers: activeConnections.size,
      drivers: Array.from(activeConnections.entries()).map(([driverId, sockets]) => ({
        driverId,
        connectionCount: sockets.size
      }))
    };
  };

  return {
    io,
    emitToAllDrivers,
    emitToDriver,
    emitBlockClaimed,
    emitBlockReleased,
    emitNewBlockAvailable,
    emitScheduleUpdated,
    emitBlockCancelled,
    emitBlockModified,
    emitCheckInStatusChanged,
    getConnectionStats
  };
}

module.exports = { initializeWebSocket };