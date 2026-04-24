// middleware/auth.js
// JWT verification middleware + role guards

const jwt = require('jsonwebtoken');

// ─── Verify JWT token ──────────────────────────────────────────────────────
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, agent_id/admin_id, name, role }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
    return res.status(403).json({ error: 'Invalid token.' });
  }
};

// ─── Agent-only guard ──────────────────────────────────────────────────────
const agentOnly = (req, res, next) => {
  if (req.user?.role !== 'agent') {
    return res.status(403).json({ error: 'Access denied. Agents only.' });
  }
  next();
};

// ─── Admin-only guard ──────────────────────────────────────────────────────
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admins only.' });
  }
  next();
};

module.exports = { verifyToken, agentOnly, adminOnly };