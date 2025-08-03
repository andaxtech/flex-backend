const db = require('../config/database'); // Adjust path to your DB config

// ===============================================
// CORE DRIVER JOURNEY FUNCTIONS
// ===============================================

// Get next available module for driver
const getNextModule = async (req, res) => {
  try {
    const { userId } = req.params;

    // Get modules driver has already completed
    const completedQuery = `
      SELECT module_id 
      FROM training_progress 
      WHERE user_id = $1
    `;
    const completedResult = await db.query(completedQuery, [userId]);
    const completedModuleIds = completedResult.rows.map(row => row.module_id);

    // Find next available module (lowest order_index not completed)
    let nextModuleQuery;
    let queryParams;

    if (completedModuleIds.length === 0) {
      // No modules completed, get first module
      nextModuleQuery = `
        SELECT * FROM training_modules 
        WHERE is_active = true 
        ORDER BY order_index 
        LIMIT 1
      `;
      queryParams = [];
    } else {
      // Find next module considering prerequisites
      nextModuleQuery = `
        SELECT tm.* FROM training_modules tm
        WHERE tm.is_active = true 
        AND tm.module_id NOT IN (${completedModuleIds.map((_, i) => `$${i + 2}`).join(',')})
        AND (
          tm.prerequisite_modules IS NULL 
          OR tm.prerequisite_modules::jsonb <@ $1::jsonb
        )
        ORDER BY tm.order_index 
        LIMIT 1
      `;
      queryParams = [JSON.stringify(completedModuleIds), ...completedModuleIds];
    }

    const result = await db.query(nextModuleQuery, queryParams);
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        message: 'All training modules completed!',
        nextModule: null,
        isComplete: true
      });
    }

    res.json({
      success: true,
      nextModule: result.rows[0],
      isComplete: false
    });

  } catch (error) {
    console.error('Error getting next module:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get next module',
      error: error.message
    });
  }
};

// Get driver's training progress
const getTrainingProgress = async (req, res) => {
  try {
    const { userId } = req.params;

    // Get completed modules with details
    const progressQuery = `
      SELECT 
        tm.module_id,
        tm.title,
        tm.category,
        tm.order_index,
        tm.points_reward,
        tp.completed_at,
        tp.score,
        tp.attempts,
        tp.time_spent
      FROM training_progress tp
      JOIN training_modules tm ON tp.module_id = tm.module_id
      WHERE tp.user_id = $1
      ORDER BY tm.order_index
    `;
    
    const progressResult = await db.query(progressQuery, [userId]);

    // Get total training points from pizza_points
    const pointsQuery = `
      SELECT COALESCE(SUM(points), 0) as total_points
      FROM pizza_points 
      WHERE driver_id = $1 AND event_type LIKE 'training_%'
    `;
    const pointsResult = await db.query(pointsQuery, [userId]);

    // Get total available modules count
    const totalModulesQuery = `
      SELECT COUNT(*) as total_modules
      FROM training_modules 
      WHERE is_active = true
    `;
    const totalResult = await db.query(totalModulesQuery);

    const completedCount = progressResult.rows.length;
    const totalCount = parseInt(totalResult.rows[0].total_modules);
    const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    res.json({
      success: true,
      progress: {
        completedModules: progressResult.rows,
        totalPoints: parseInt(pointsResult.rows[0].total_points),
        completedCount,
        totalCount,
        completionPercentage
      }
    });

  } catch (error) {
    console.error('Error getting training progress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get training progress',
      error: error.message
    });
  }
};

// Complete a training module
const completeModule = async (req, res) => {
  try {
    const { userId, moduleId, score, timeSpent, h5pResultData } = req.body;

    // Validate required fields
    if (!userId || !moduleId) {
      return res.status(400).json({
        success: false,
        message: 'userId and moduleId are required'
      });
    }

    // Get module details
    const moduleQuery = `
      SELECT * FROM training_modules WHERE module_id = $1
    `;
    const moduleResult = await db.query(moduleQuery, [moduleId]);
    
    if (moduleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Training module not found'
      });
    }

    const module = moduleResult.rows[0];

    // Check if already completed
    const existingProgressQuery = `
      SELECT * FROM training_progress 
      WHERE user_id = $1 AND module_id = $2
    `;
    const existingResult = await db.query(existingProgressQuery, [userId, moduleId]);

    let attempts = 1;
    if (existingResult.rows.length > 0) {
      attempts = existingResult.rows[0].attempts + 1;
    }

    // Check if score meets passing requirement
    const passed = score >= module.passing_score;
    
    if (!passed && attempts >= module.max_attempts) {
      return res.status(400).json({
        success: false,
        message: `Maximum attempts (${module.max_attempts}) reached. Score of ${module.passing_score}% required.`
      });
    }

    // Start transaction
    await db.query('BEGIN');

    try {
      // Insert or update progress
      if (existingResult.rows.length === 0) {
        // Insert new progress record
        const insertProgressQuery = `
          INSERT INTO training_progress 
          (user_id, module_id, completed_at, score, attempts, time_spent, h5p_result_data)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;
        await db.query(insertProgressQuery, [
          userId, moduleId, 
          passed ? new Date() : null,
          score, attempts, timeSpent || 0, 
          h5pResultData ? JSON.stringify(h5pResultData) : null
        ]);
      } else {
        // Update existing progress
        const updateProgressQuery = `
          UPDATE training_progress 
          SET completed_at = $3, score = $4, attempts = $5, 
              time_spent = $6, h5p_result_data = $7
          WHERE user_id = $1 AND module_id = $2
          RETURNING *
        `;
        await db.query(updateProgressQuery, [
          userId, moduleId,
          passed ? new Date() : null,
          score, attempts, timeSpent || 0,
          h5pResultData ? JSON.stringify(h5pResultData) : null
        ]);
      }

      // Award points only if passed and first time completing
      if (passed && existingResult.rows.length === 0) {
        const insertPointsQuery = `
          INSERT INTO pizza_points (driver_id, event_type, points, tag)
          VALUES ($1, 'training_module', $2, $3)
        `;
        await db.query(insertPointsQuery, [userId, module.points_reward, module.point_tag]);
      }

      await db.query('COMMIT');

      res.json({
        success: true,
        message: passed ? 'Module completed successfully!' : 'Score too low, try again',
        passed,
        score,
        attempts,
        pointsEarned: (passed && existingResult.rows.length === 0) ? module.points_reward : 0
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error completing module:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete module',
      error: error.message
    });
  }
};

// ===============================================
// GAMIFICATION FUNCTIONS
// ===============================================

// Get driver's earned badges
const getDriverBadges = async (req, res) => {
  try {
    const { userId } = req.params;

    const badgesQuery = `
      SELECT 
        badge_name,
        badge_description,
        badge_category,
        earned_at,
        points_awarded,
        badge_icon_url
      FROM training_badges 
      WHERE user_id = $1
      ORDER BY earned_at DESC
    `;
    
    const result = await db.query(badgesQuery, [userId]);

    res.json({
      success: true,
      badges: result.rows
    });

  } catch (error) {
    console.error('Error getting driver badges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get badges',
      error: error.message
    });
  }
};

// Award badge to driver
const awardBadge = async (req, res) => {
  try {
    const { userId, badgeName, pointsAwarded = 0 } = req.body;

    // Get badge template (first occurrence of this badge name)
    const badgeTemplateQuery = `
      SELECT * FROM training_badges 
      WHERE badge_name = $1 AND user_id IS NULL 
      LIMIT 1
    `;
    const templateResult = await db.query(badgeTemplateQuery, [badgeName]);

    if (templateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Badge template not found'
      });
    }

    const template = templateResult.rows[0];

    // Check if user already has this badge
    const existingBadgeQuery = `
      SELECT * FROM training_badges 
      WHERE user_id = $1 AND badge_name = $2
    `;
    const existingResult = await db.query(existingBadgeQuery, [userId, badgeName]);

    if (existingResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Badge already earned'
      });
    }

    // Start transaction
    await db.query('BEGIN');

    try {
      // Award badge
      const awardBadgeQuery = `
        INSERT INTO training_badges 
        (badge_name, badge_description, badge_icon_url, user_id, points_awarded, point_tag, badge_category)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      
      const badgeResult = await db.query(awardBadgeQuery, [
        template.badge_name,
        template.badge_description,
        template.badge_icon_url,
        userId,
        pointsAwarded || template.points_awarded,
        template.point_tag,
        template.badge_category
      ]);

      // Award points in pizza_points
      if (pointsAwarded > 0) {
        const insertPointsQuery = `
          INSERT INTO pizza_points (driver_id, event_type, points, tag)
          VALUES ($1, 'training_badge', $2, $3)
        `;
        await db.query(insertPointsQuery, [userId, pointsAwarded, template.point_tag]);
      }

      await db.query('COMMIT');

      res.json({
        success: true,
        message: 'Badge awarded successfully!',
        badge: badgeResult.rows[0]
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error awarding badge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to award badge',
      error: error.message
    });
  }
};

// Get driver's training stats
const getTrainingStats = async (req, res) => {
  try {
    const { userId } = req.params;

    // Get total training points
    const pointsQuery = `
      SELECT COALESCE(SUM(points), 0) as total_training_points
      FROM pizza_points 
      WHERE driver_id = $1 AND event_type LIKE 'training_%'
    `;
    const pointsResult = await db.query(pointsQuery, [userId]);

    // Get badges count
    const badgesQuery = `
      SELECT COUNT(*) as badge_count
      FROM training_badges 
      WHERE user_id = $1
    `;
    const badgesResult = await db.query(badgesQuery, [userId]);

    // Get completion stats
    const completionQuery = `
      SELECT 
        COUNT(*) as completed_modules,
        AVG(score) as average_score
      FROM training_progress 
      WHERE user_id = $1 AND completed_at IS NOT NULL
    `;
    const completionResult = await db.query(completionQuery, [userId]);

    // Calculate level (simple calculation: level = points / 100)
    const totalPoints = parseInt(pointsResult.rows[0].total_training_points);
    const currentLevel = Math.floor(totalPoints / 100) + 1;

    res.json({
      success: true,
      stats: {
        totalTrainingPoints: totalPoints,
        currentLevel,
        badgeCount: parseInt(badgesResult.rows[0].badge_count),
        completedModules: parseInt(completionResult.rows[0].completed_modules || 0),
        averageScore: parseFloat(completionResult.rows[0].average_score || 0).toFixed(1)
      }
    });

  } catch (error) {
    console.error('Error getting training stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get training stats',
      error: error.message
    });
  }
};

// ===============================================
// MODULE & H5P FUNCTIONS
// ===============================================

// Get all available modules
const getAllModules = async (req, res) => {
  try {
    const query = `
      SELECT * FROM training_modules 
      WHERE is_active = true 
      ORDER BY order_index
    `;
    
    const result = await db.query(query);

    res.json({
      success: true,
      modules: result.rows
    });

  } catch (error) {
    console.error('Error getting all modules:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get modules',
      error: error.message
    });
  }
};

// Get specific module details
const getModuleDetails = async (req, res) => {
  try {
    const { moduleId } = req.params;

    const query = `
      SELECT * FROM training_modules 
      WHERE module_id = $1 AND is_active = true
    `;
    
    const result = await db.query(query, [moduleId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Module not found'
      });
    }

    res.json({
      success: true,
      module: result.rows[0]
    });

  } catch (error) {
    console.error('Error getting module details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get module details',
      error: error.message
    });
  }
};

// Get H5P content for module
const getH5PContent = async (req, res) => {
  try {
    const { moduleId } = req.params;

    // Get module with H5P content details
    const query = `
      SELECT 
        tm.*,
        thc.title as h5p_title,
        thc.content_type,
        thc.cloudinary_url,
        thc.h5p_parameters
      FROM training_modules tm
      LEFT JOIN training_h5p_content thc ON tm.cloudinary_public_id = thc.cloudinary_public_id
      WHERE tm.module_id = $1 AND tm.is_active = true
    `;
    
    const result = await db.query(query, [moduleId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'H5P content not found for this module'
      });
    }

    res.json({
      success: true,
      h5pContent: result.rows[0]
    });

  } catch (error) {
    console.error('Error getting H5P content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get H5P content',
      error: error.message
    });
  }
};

// Save H5P result data
const saveH5PResult = async (req, res) => {
  try {
    const { userId, moduleId, h5pResultData, score, timeSpent } = req.body;

    // Update training_progress with H5P result
    const updateQuery = `
      UPDATE training_progress 
      SET h5p_result_data = $3
      WHERE user_id = $1 AND module_id = $2
      RETURNING *
    `;
    
    const result = await db.query(updateQuery, [userId, moduleId, JSON.stringify(h5pResultData)]);

    res.json({
      success: true,
      message: 'H5P result saved successfully',
      saved: result.rows.length > 0
    });

  } catch (error) {
    console.error('Error saving H5P result:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save H5P result',
      error: error.message
    });
  }
};

// ===============================================
// ADMIN/ANALYTICS FUNCTIONS
// ===============================================

// Get training analytics overview
const getTrainingAnalytics = async (req, res) => {
  try {
    // Total drivers in training
    const totalDriversQuery = `
      SELECT COUNT(DISTINCT user_id) as total_drivers
      FROM training_progress
    `;
    const totalDriversResult = await db.query(totalDriversQuery);

    // Completion rates by module
    const moduleStatsQuery = `
      SELECT 
        tm.title,
        tm.category,
        COUNT(tp.user_id) as completions,
        AVG(tp.score) as avg_score
      FROM training_modules tm
      LEFT JOIN training_progress tp ON tm.module_id = tp.module_id 
        AND tp.completed_at IS NOT NULL
      WHERE tm.is_active = true
      GROUP BY tm.module_id, tm.title, tm.category
      ORDER BY tm.order_index
    `;
    const moduleStatsResult = await db.query(moduleStatsQuery);

    // Top performers
    const topPerformersQuery = `
      SELECT 
        u.username,
        COUNT(tp.module_id) as completed_modules,
        AVG(tp.score) as avg_score,
        SUM(pp.points) as total_points
      FROM users u
      JOIN training_progress tp ON u.user_id = tp.user_id
      LEFT JOIN pizza_points pp ON u.user_id = pp.driver_id 
        AND pp.event_type LIKE 'training_%'
      WHERE tp.completed_at IS NOT NULL
      GROUP BY u.user_id, u.username
      ORDER BY total_points DESC, completed_modules DESC
      LIMIT 10
    `;
    const topPerformersResult = await db.query(topPerformersQuery);

    res.json({
      success: true,
      analytics: {
        totalDriversInTraining: parseInt(totalDriversResult.rows[0].total_drivers),
        moduleCompletionStats: moduleStatsResult.rows,
        topPerformers: topPerformersResult.rows
      }
    });

  } catch (error) {
    console.error('Error getting training analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get training analytics',
      error: error.message
    });
  }
};

// Get training leaderboard
const getTrainingLeaderboard = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const leaderboardQuery = `
      SELECT 
        u.user_id,
        u.username,
        d.first_name,
        d.last_name,
        COUNT(DISTINCT tp.module_id) as completed_modules,
        COALESCE(SUM(pp.points), 0) as total_training_points,
        AVG(tp.score) as avg_score,
        COUNT(DISTINCT tb.badge_id) as badge_count,
        MAX(tp.completed_at) as last_activity
      FROM users u
      JOIN drivers d ON u.user_id = d.user_id
      LEFT JOIN training_progress tp ON u.user_id = tp.user_id AND tp.completed_at IS NOT NULL
      LEFT JOIN pizza_points pp ON u.user_id = pp.driver_id AND pp.event_type LIKE 'training_%'
      LEFT JOIN training_badges tb ON u.user_id = tb.user_id
      WHERE u.role = 'driver'
      GROUP BY u.user_id, u.username, d.first_name, d.last_name
      HAVING COUNT(DISTINCT tp.module_id) > 0
      ORDER BY total_training_points DESC, completed_modules DESC
      LIMIT $1
    `;
    
    const result = await db.query(leaderboardQuery, [limit]);

    res.json({
      success: true,
      leaderboard: result.rows.map((row, index) => ({
        rank: index + 1,
        ...row,
        avg_score: parseFloat(row.avg_score || 0).toFixed(1)
      }))
    });

  } catch (error) {
    console.error('Error getting training leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get training leaderboard',
      error: error.message
    });
  }
};

// Reset driver's training progress (admin only)
const resetTrainingProgress = async (req, res) => {
  try {
    const { userId } = req.params;
    const { confirm } = req.body;

    if (!confirm) {
      return res.status(400).json({
        success: false,
        message: 'Please confirm reset by sending { "confirm": true }'
      });
    }

    // Start transaction
    await db.query('BEGIN');

    try {
      // Delete training progress
      await db.query('DELETE FROM training_progress WHERE user_id = $1', [userId]);
      
      // Delete training badges
      await db.query('DELETE FROM training_badges WHERE user_id = $1', [userId]);
      
      // Delete training pizza points
      await db.query('DELETE FROM pizza_points WHERE driver_id = $1 AND event_type LIKE \'training_%\'', [userId]);

      await db.query('COMMIT');

      res.json({
        success: true,
        message: 'Training progress reset successfully'
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error resetting training progress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset training progress',
      error: error.message
    });
  }
};

module.exports = {
  // Core journey functions
  getNextModule,
  getTrainingProgress,
  completeModule,
  
  // Gamification functions
  getDriverBadges,
  awardBadge,
  getTrainingStats,
  
  // Module & H5P functions
  getAllModules,
  getModuleDetails,
  getH5PContent,
  saveH5PResult,
  
  // Admin/analytics functions
  getTrainingAnalytics,
  getTrainingLeaderboard,
  resetTrainingProgress
};