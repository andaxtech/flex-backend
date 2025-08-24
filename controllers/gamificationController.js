const pool = require('../db');

// Function to check and award badges
async function checkAndAwardBadges(client, driver_id) {
  try {
    // Get driver's current stats
    const statsQuery = `
      WITH driver_stats AS (
        SELECT 
          d.driver_id,
          COUNT(DISTINCT dl.delivery_id) as total_deliveries,
          COUNT(DISTINCT bc.block_id) as total_blocks,
          COUNT(DISTINCT CASE 
            WHEN dl.delivery_completed_at - dl.delivery_started_at <= INTERVAL '30 minutes' 
            THEN dl.delivery_id 
          END) as fast_deliveries,
          COUNT(DISTINCT CASE 
            WHEN dl.delivery_completed_at - dl.delivery_started_at <= INTERVAL '15 minutes' 
            THEN dl.delivery_id 
          END) as ultra_fast_deliveries,
          COUNT(DISTINCT CASE 
            WHEN EXTRACT(DOW FROM bc.check_in_time) IN (0, 6) 
            THEN bc.block_id 
          END) as weekend_blocks,
          SUM(pp.points) as total_points
        FROM drivers d
        LEFT JOIN delivery_logs dl ON d.driver_id = dl.driver_id
        LEFT JOIN block_claims bc ON d.driver_id = bc.driver_id
        LEFT JOIN pizza_points pp ON d.driver_id = pp.driver_id
        WHERE d.driver_id = $1
        GROUP BY d.driver_id
      )
      SELECT * FROM driver_stats
    `;
    
    const stats = await client.query(statsQuery, [driver_id]);
    if (stats.rows.length === 0) return;
    
    const driverStats = stats.rows[0];
    
    // Check each badge criteria
    const badgesToCheck = [
      {
        key: 'first_pie_out',
        check: driverStats.total_deliveries >= 1,
        stats: { deliveries: driverStats.total_deliveries }
      },
      {
        key: 'thirty_min_legend',
        check: driverStats.fast_deliveries >= 10,
        stats: { fast_deliveries: driverStats.fast_deliveries }
      },
      {
        key: 'box_stacker',
        check: driverStats.total_blocks >= 25,
        stats: { blocks: driverStats.total_blocks }
      },
      {
        key: 'turbo_tipper',
        check: driverStats.ultra_fast_deliveries >= 5,
        stats: { ultra_fast_deliveries: driverStats.ultra_fast_deliveries }
      }
    ];
    
    for (const badge of badgesToCheck) {
      if (badge.check) {
        // Check if badge already earned
        const existingBadge = await client.query(
          'SELECT id FROM driver_badges WHERE driver_id = $1 AND badge_key = $2',
          [driver_id, badge.key]
        );
        
        if (existingBadge.rows.length === 0) {
          // Get badge definition
          const badgeDef = await client.query(
            'SELECT points_reward, badge_name FROM badge_definitions WHERE badge_key = $1',
            [badge.key]
          );
          
          if (badgeDef.rows.length > 0) {
            const { points_reward, badge_name } = badgeDef.rows[0];
            
            // Award badge
            await client.query(`
              INSERT INTO driver_badges (driver_id, badge_key, points_awarded, unlock_details)
              VALUES ($1, $2, $3, $4)
            `, [driver_id, badge.key, points_reward, badge.stats]);
            
            // Award badge points
            await client.query(`
              INSERT INTO pizza_points (driver_id, event_type, points, event_time, metadata)
              VALUES ($1, $2, $3, NOW(), $4)
            `, [
              driver_id,
              'badge_earned',
              points_reward,
              JSON.stringify({
                badge_key: badge.key,
                badge_name: badge_name,
                achievement_stats: badge.stats
              })
            ]);
            
            console.log(`🏆 Awarded ${badge_name} badge to driver ${driver_id}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking badges:', error);
  }
}

// Manager rating endpoint
exports.submitManagerRating = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { driver_id, block_id, claim_id, rating, feedback, manager_id } = req.body;
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    // Award points for 5-star rating
    if (rating === 5) {
      await client.query(`
        INSERT INTO pizza_points (driver_id, event_type, points, event_time, block_id, claim_id, manager_rating, metadata)
        VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
      `, [
        driver_id,
        'manager_rating_5',
        15,
        block_id,
        claim_id,
        rating,
        JSON.stringify({
          manager_id: manager_id,
          feedback: feedback,
          rating_date: new Date().toISOString()
        })
      ]);
    }
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: rating === 5 ? 'Driver earned 15 Pizza Points for 5-star rating!' : 'Rating submitted successfully'
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error submitting rating:', error);
    res.status(500).json({ error: 'Failed to submit rating' });
  } finally {
    client.release();
  }
};

// Dashboard endpoint
exports.getDriverDashboard = async (req, res) => {
  try {
    const { driver_id } = req.params;
    
    // Get driver info and level
    const driverQuery = `
      SELECT 
        d.driver_id,
        d.first_name,
        d.last_name,
        d.profile_photo_gcs_path,
        dl.total_points,
        dl.level_name,
        dl.level_number
      FROM drivers d
      LEFT JOIN driver_levels dl ON d.driver_id = dl.driver_id
      WHERE d.driver_id = $1
    `;
    
    const driverResult = await pool.query(driverQuery, [driver_id]);
    if (driverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const driver = driverResult.rows[0];
    
    // Calculate XP progress to next level
    const levelThresholds = [0, 1000, 2000, 4000, 7000, 10000];
    const currentThreshold = levelThresholds[driver.level_number - 1] || 0;
    const nextThreshold = levelThresholds[driver.level_number] || 10000;
    const xpInCurrentLevel = driver.total_points - currentThreshold;
    const xpNeededForLevel = nextThreshold - currentThreshold;
    const xpPercent = Math.round((xpInCurrentLevel / xpNeededForLevel) * 100);
    
    // Get earned badges with full badge definition data
    const badgesQuery = `
      SELECT 
        bd.badge_key,
        bd.badge_name,
        bd.badge_description,
        bd.badge_icon_url,
        bd.badge_emoji,
        bd.points_reward,
        db.earned_at
      FROM driver_badges db
      JOIN badge_definitions bd ON db.badge_key = bd.badge_key
      WHERE db.driver_id = $1 AND bd.is_active = true
      ORDER BY db.earned_at DESC
    `;
    
    const badgesResult = await pool.query(badgesQuery, [driver_id]);
    
    // Get weekly leaderboard for driver's market
    const leaderboardQuery = `
      WITH driver_market AS (
        SELECT city FROM drivers WHERE driver_id = $1
      ),
      weekly_points AS (
        SELECT 
          d.driver_id,
          CONCAT(d.first_name, ' ', d.last_name) as driver_name,
          d.city,
          COALESCE(SUM(pp.points), 0) as total_points
        FROM drivers d
        CROSS JOIN driver_market dm
        LEFT JOIN pizza_points pp ON d.driver_id = pp.driver_id 
          AND pp.event_time >= date_trunc('week', CURRENT_DATE)
        WHERE d.city = dm.city
        GROUP BY d.driver_id, d.first_name, d.last_name, d.city
      )
      SELECT 
        driver_id,
        driver_name,
        total_points,
        RANK() OVER (ORDER BY total_points DESC) as rank
      FROM weekly_points
      ORDER BY rank
      LIMIT 10
    `;
    
    const leaderboardResult = await pool.query(leaderboardQuery, [driver_id]);
    
    // Get current streak
    const streakQuery = `
      WITH consecutive_days AS (
        SELECT 
          DATE(check_in_time) as work_date,
          LAG(DATE(check_in_time)) OVER (ORDER BY DATE(check_in_time)) as prev_date
        FROM block_claims
        WHERE driver_id = $1
          AND status = 'completed'
          AND check_in_time >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY DATE(check_in_time)
      ),
      streak_groups AS (
        SELECT 
          work_date,
          SUM(CASE WHEN work_date - prev_date > 1 OR prev_date IS NULL THEN 1 ELSE 0 END) 
            OVER (ORDER BY work_date) as streak_group
        FROM consecutive_days
      ),
      current_streak AS (
        SELECT 
          COUNT(*) as streak_days
        FROM streak_groups
        WHERE streak_group = (
          SELECT streak_group 
          FROM streak_groups 
          WHERE work_date = CURRENT_DATE
          LIMIT 1
        )
      )
      SELECT COALESCE(MAX(streak_days), 0) as streak_days FROM current_streak
    `;
    
    const streakResult = await pool.query(streakQuery, [driver_id]);
    
    // Get driver stats
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT bc.block_id) as blocks_completed,
        COALESCE(
          ROUND(
            COUNT(DISTINCT CASE WHEN dl.delivery_completed_at - dl.delivery_started_at <= INTERVAL '30 minutes' THEN dl.delivery_id END) * 100.0 / 
            NULLIF(COUNT(DISTINCT dl.delivery_id), 0)
          ), 
          100
        ) as on_time_rate
      FROM drivers d
      LEFT JOIN block_claims bc ON d.driver_id = bc.driver_id AND bc.status = 'completed'
      LEFT JOIN delivery_logs dl ON d.driver_id = dl.driver_id
      WHERE d.driver_id = $1
    `;
    
    const statsResult = await pool.query(statsQuery, [driver_id]);
    const stats = statsResult.rows[0];
    
    res.json({
      name: driver.first_name,
      level: driver.level_number || 1,
      levelName: driver.level_name || 'Rookie Rider',
      xp: driver.total_points || 0,
      xpPercent: xpPercent,
      xpToNextLevel: nextThreshold - (driver.total_points || 0),
      currentStreak: parseInt(streakResult.rows[0].streak_days) || 0,
      blocksCompleted: parseInt(stats.blocks_completed) || 0,
      onTimeRate: parseInt(stats.on_time_rate) || 100,
      badges: badgesResult.rows,  // Return raw badge data with all fields
      leaderboard: leaderboardResult.rows  // Return raw leaderboard data
    });
    
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

// Get driver points history
exports.getPointsHistory = async (req, res) => {
  try {
    const { driver_id } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const query = `
      SELECT 
        pp.id,
        pp.event_type,
        pp.points,
        pp.event_time,
        pp.metadata,
        CASE 
          WHEN pp.event_type = 'block_completion' THEN 'Block Completed'
          WHEN pp.event_type = 'manager_rating_5' THEN '5-Star Manager Rating'
          WHEN pp.event_type = 'badge_earned' THEN CONCAT('Badge Earned: ', (pp.metadata->>'badge_name')::text)
          WHEN pp.event_type = 'streak_bonus' THEN CONCAT('Streak Bonus: Day ', (pp.metadata->>'streak_day')::text)
          ELSE pp.event_type
        END as description
      FROM pizza_points pp
      WHERE pp.driver_id = $1
      ORDER BY pp.event_time DESC
      LIMIT $2
    `;
    
    const result = await pool.query(query, [driver_id, limit]);
    
    res.json({
      points_history: result.rows
    });
    
  } catch (error) {
    console.error('Error fetching points history:', error);
    res.status(500).json({ error: 'Failed to fetch points history' });
  }
};

// Get all available badges
exports.getAllBadges = async (req, res) => {
  try {
    const query = `
      SELECT 
        badge_key,
        badge_name,
        badge_description,
        badge_icon_url,
        badge_emoji,
        points_reward,
        unlock_criteria_type,
        unlock_criteria_value
      FROM badge_definitions
      WHERE is_active = true
      ORDER BY points_reward ASC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      badges: result.rows
    });
    
  } catch (error) {
    console.error('Error fetching badges:', error);
    res.status(500).json({ error: 'Failed to fetch badges' });
  }
};

module.exports = {
  checkAndAwardBadges,
  submitManagerRating,
  getDriverDashboard,
  getPointsHistory,
  getAllBadges
};