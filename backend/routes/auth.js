// routes/auth.js
// POST /api/auth/login  — handles both agent and admin login

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../db/connection');

const router = express.Router();

// ─── Validation rules ──────────────────────────────────────────────────────
const loginValidation = [
  body('login_id')
    .trim()
    .notEmpty().withMessage('Login ID is required')
    .isLength({ min: 3, max: 50 }).withMessage('Invalid login ID'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password too short'),
  body('role')
    .isIn(['agent', 'admin']).withMessage('Role must be "agent" or "admin"'),
];

// ─── POST /api/auth/login ──────────────────────────────────────────────────
router.post('/login', loginValidation, async (req, res) => {
  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { login_id, password, role } = req.body;

  try {
    let user = null;

    if (role === 'agent') {
      // Look up in agents table
      const result = await query(
        'SELECT id, agent_name AS name, agent_id, password, is_active FROM agents WHERE agent_id = $1',
        [login_id]
      );
      user = result.rows[0];

      if (!user) {
        return res.status(401).json({ error: 'Invalid Agent ID or password.' });
      }
      if (!user.is_active) {
        return res.status(403).json({ error: 'Your account has been deactivated. Contact admin.' });
      }
    } else {
      // Look up in admins table
      const result = await query(
        'SELECT id, admin_name AS name, admin_id AS agent_id, password FROM admins WHERE admin_id = $1',
        [login_id]
      );
      user = result.rows[0];

      if (!user) {
        return res.status(401).json({ error: 'Invalid Admin ID or password.' });
      }
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid login credentials.' });
    }

    // Generate JWT
    const payload = {
      id:       user.id,
      login_id: user.agent_id,
      name:     user.name,
      role,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    return res.json({
      message: `Welcome, ${user.name}!`,
      token,
      user: {
        name:     user.name,
        login_id: user.agent_id,
        role,
      },
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

// ─── POST /api/auth/verify  — check if token is valid ─────────────────────
router.get('/verify', require('../middleware/auth').verifyToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

module.exports = router;