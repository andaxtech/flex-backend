const gamificationController = require('../controllers/gamificationController');

// Gamification routes
router.post('/api/manager/rating', gamificationController.submitManagerRating);
router.get('/api/driver/:driver_id/dashboard', gamificationController.getDriverDashboard);
router.get('/api/driver/:driver_id/points/history', gamificationController.getPointsHistory);
router.get('/api/badges/all', gamificationController.getAllBadges);