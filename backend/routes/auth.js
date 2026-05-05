// routes/auth.js
// POST /api/auth/login  — handles both agent and admin login

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query, pool } = require('../db/connection');
const { sendAdminOtp } = require('../services/adminOtpEmailService');

const router = express.Router();

const OTP_TTL_MINUTES = 10;
const OTP_LENGTH = 6;

const genOtp = () => {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
};

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
// â”€â”€â”€ Admin Forgot Password: send OTP to registered email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/admin/forgot-password', [
  body('admin_id').trim().notEmpty().isLength({ min: 3, max: 50 }),
  body('email').trim().isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { admin_id, email } = req.body;

  try {
    const aRes = await query('SELECT id, admin_id, admin_name, email FROM admins WHERE admin_id = $1', [admin_id]);
    const admin = aRes.rows[0];
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });

    if (admin.email && admin.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ error: 'Email does not match this Admin ID.' });
    }

    if (!admin.email) {
      await query('UPDATE admins SET email=$1 WHERE id=$2', [email, admin.id]);
    }

    const otp = genOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    await query(
      `INSERT INTO admin_password_resets (admin_ref, otp_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
      [admin.id, otpHash, OTP_TTL_MINUTES]
    );

    const emailResult = await sendAdminOtp(email, otp, {
      adminName: admin.admin_name,
      adminId: admin.admin_id,
      ttlMinutes: OTP_TTL_MINUTES,
    });

    if (!emailResult.sent) {
      return res.status(500).json({ error: 'Failed to send OTP email. Check SMTP config.' });
    }

    return res.json({ message: 'OTP sent to your email.' });
  } catch (err) {
    console.error('[AUTH] admin forgot-password error:', err.message);
    return res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// â”€â”€â”€ Admin Reset Password (+ optionally Admin ID) using OTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/admin/reset-password', [
  body('admin_id').trim().notEmpty().isLength({ min: 3, max: 50 }),
  body('email').trim().isEmail().normalizeEmail(),
  body('otp').trim().isLength({ min: OTP_LENGTH, max: OTP_LENGTH }),
  body('new_password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('new_admin_id').optional({ checkFalsy: true }).trim().isLength({ min: 3, max: 50 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { admin_id, email, otp, new_password, new_admin_id } = req.body;

  try {
    const aRes = await query('SELECT id, admin_id, email FROM admins WHERE admin_id = $1', [admin_id]);
    const admin = aRes.rows[0];
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });
    if (!admin.email || admin.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ error: 'Email does not match this Admin ID.' });
    }

    const rRes = await query(
      `SELECT id, otp_hash
       FROM admin_password_resets
       WHERE admin_ref=$1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [admin.id]
    );
    const reset = rRes.rows[0];
    if (!reset) return res.status(400).json({ error: 'OTP expired or not requested.' });

    const ok = await bcrypt.compare(String(otp), reset.otp_hash);
    if (!ok) return res.status(400).json({ error: 'Invalid OTP.' });

    const nextAdminId = (new_admin_id || '').trim() || admin.admin_id;
    if (nextAdminId !== admin.admin_id) {
      const taken = await query('SELECT id FROM admins WHERE admin_id=$1', [nextAdminId]);
      if (taken.rows.length) return res.status(400).json({ error: 'New Admin ID is already in use.' });
    }

    const passHash = await bcrypt.hash(new_password, 12);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE admins SET admin_id=$1, password=$2 WHERE id=$3', [nextAdminId, passHash, admin.id]);
      await client.query('UPDATE admin_password_resets SET used_at=NOW() WHERE admin_ref=$1 AND used_at IS NULL', [admin.id]);
      await client.query('COMMIT');
      return res.json({ message: 'Password updated successfully.', admin_id: nextAdminId });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[AUTH] admin reset-password error:', err.message);
    return res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
});

router.get('/verify', require('../middleware/auth').verifyToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

module.exports = router;
