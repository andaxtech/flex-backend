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
    
    // Get badges
    const badgesQuery = `
      SELECT 
        bd.badge_key,
        bd.badge_name as label,
        bd.badge_icon_url as icon,
        CASE WHEN db.id IS NOT NULL THEN true ELSE false END as earned
      FROM badge_definitions bd
      LEFT JOIN driver_badges db ON bd.badge_key = db.badge_key AND db.driver_id = $1
      WHERE bd.is_active = true
      ORDER BY earned DESC, bd.badge_key
    `;
    
    const badgesResult = await pool.query(badgesQuery, [driver_id]);
    
    // Get weekly leaderboard for driver's market
    const leaderboardQuery = `
      SELECT 
        driver_id,
        full_name as name,
        weekly_points as weeklyXp,
        market_rank
      FROM weekly_leaderboard
      WHERE market = (SELECT city FROM drivers WHERE driver_id = $1)
      ORDER BY market_rank
      LIMIT 10
    `;
    
    const leaderboardResult = await pool.query(leaderboardQuery, [driver_id]);
    
    // Get current streak (simplified for now)
    const streakQuery = `
      SELECT COUNT(DISTINCT DATE(check_in_time)) as streak_days
      FROM block_claims
      WHERE driver_id = $1
        AND status = 'completed'
        AND check_in_time >= CURRENT_DATE - INTERVAL '30 days'
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
      level: driver.level_number,
      levelName: driver.level_name,
      xp: driver.total_points || 0,
      xpPercent: xpPercent,
      xpToNextLevel: nextThreshold - driver.total_points,
      currentStreak: streakResult.rows[0].streak_days || 0,
      blocksCompleted: parseInt(stats.blocks_completed) || 0,
      onTimeRate: parseInt(stats.on_time_rate) || 100,
      badges: badgesResult.rows.map(b => ({
        key: b.badge_key,
        label: b.label,
        icon: { uri: b.icon || 'https://via.placeholder.com/60' },
        earned: b.earned
      })),
      leaderboard: leaderboardResult.rows.map(l => ({
        id: l.driver_id,
        name: l.name,
        avatar: { uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(l.name)}&size=128` },
        weeklyXp: l.weeklyXp || 0
      }))
    });
    
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

module.exports = {
  checkAndAwardBadges,
  submitManagerRating,
  getDriverDashboard
};