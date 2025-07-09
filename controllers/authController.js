// FLEX-BACKEND/controllers/authController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_secret';

exports.register = async (req, res) => {
  const { username, password_hash, email } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, email, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
      [username, password_hash, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = userRes.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ user_id: user.user_id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
};