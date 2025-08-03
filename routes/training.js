const express = require('express');
const router = express.Router();
const trainingController = require('../controllers/trainingController');

// ===============================================
// DRIVER TRAINING API ROUTES
// ===============================================

// Get next available module for driver journey
router.get('/next-module/:userId', trainingController.getNextModule);

// Get driver's current training progress
router.get('/progress/:userId', trainingController.getTrainingProgress);

// Complete a training module (award points, update progress)
router.post('/complete-module', trainingController.completeModule);

// Get all badges earned by driver
router.get('/badges/:userId', trainingController.getDriverBadges);

// Award badge to driver (triggered by milestones)
router.post('/award-badge', trainingController.awardBadge);

// Get driver's training stats (total points, level, completion %)
router.get('/stats/:userId', trainingController.getTrainingStats);

// Get all available training modules (for admin/testing)
router.get('/modules', trainingController.getAllModules);

// Get specific module details
router.get('/module/:moduleId', trainingController.getModuleDetails);

// ===============================================
// H5P CONTENT ROUTES
// ===============================================

// Get H5P content for specific module
router.get('/h5p-content/:moduleId', trainingController.getH5PContent);

// Save H5P result data when user completes H5P content
router.post('/h5p-result', trainingController.saveH5PResult);

// ===============================================
// ADMIN/MANAGER ROUTES
// ===============================================

// Get training analytics for all drivers
router.get('/analytics/overview', trainingController.getTrainingAnalytics);

// Get leaderboard (top performers)
router.get('/leaderboard', trainingController.getTrainingLeaderboard);

// Reset driver's training progress (admin only)
router.post('/reset-progress/:userId', trainingController.resetTrainingProgress);

// ===============================================
// CLOUDINARY VERIFICATION ROUTES
// ===============================================

// Verify and create required Cloudinary folder structure
router.get('/cloudinary/verify-folders', trainingController.verifyCloudinaryFolders);

// Get info about specific Cloudinary folder
router.get('/cloudinary/folder-info/:folderPath(*)', trainingController.getCloudinaryFolderInfo);
router.get('/cloudinary/folder-info', trainingController.getCloudinaryFolderInfo); // Default to training/h5p

// Upload test H5P content to verify folder works
router.post('/cloudinary/upload-test', trainingController.uploadTestH5PContent);

// Cleanup test files
router.delete('/cloudinary/cleanup-test', trainingController.cleanupTestFiles);

// Quick Cloudinary connection test
router.get('/cloudinary/test-connection', async (req, res) => {
  try {
    const result = await require('cloudinary').v2.api.ping();
    res.json({
      success: true,
      message: 'Cloudinary connection successful',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Cloudinary connection failed',
      error: error.message
    });
  }
});

module.exports = router;