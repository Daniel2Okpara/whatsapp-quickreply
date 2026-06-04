const jwt = require('jsonwebtoken');

/**
 * Authentication Middleware
 * Fixes ERR_HTTP_HEADERS_SENT by ensuring every branch returns immediately.
 */
const protect = async (req, res, next) => {
  // 1. Guard: If headers were already sent, exit immediately.
  if (res.headersSent) return;

  const authHeader = req.headers.authorization;
  // Temporary debug logs to diagnose extension 404 on authenticated email-change
  try {
    console.log(`[Auth][protect] ${req.method} ${req.originalUrl} - Authorization header present: ${authHeader ? 'yes' : 'no'}`);
  } catch (e) {
    // ignore logging failures
  }

  // 2. Branch: Token present
  if (authHeader && authHeader.toLowerCase().startsWith('bearer')) {
    try {
      const token = String(authHeader.split(' ')[1] || '').trim();
      if (!token) {
        console.warn('[Auth][protect] Bearer present but token missing; rejecting as unauthorized');
        return res.status(401).json({ error: 'Not authorized, token missing' });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_production_key_2026');
      } catch (jwtErr) {
        console.error('[Auth][protect] JWT verify failed:', jwtErr.message);
        return res.status(401).json({ error: 'Not authorized, token failed' });
      }
      
      // Attach user info including role
      req.user = { 
        id: decoded.id, 
        _id: decoded.id, 
        isAdmin: !!decoded.isAdmin,
        role: decoded.role || 'user'
      };
      
      // Success: Proceed and RETURN
      return next();

    } catch (error) {
      // Failure: Send error and RETURN
      console.error('[Auth][protect] Unexpected error:', error && error.message ? error.message : error);
      return res.status(401).json({ error: 'Not authorized, token failed' });
    }
  }

  // 3. Branch: No token found
  return res.status(401).json({ error: 'Not authorized, no token' });
};

/**
 * Role-Based Access Control Middlewares
 */
const requireAdmin = (req, res, next) => {
  if (res.headersSent) return;
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.isAdmin === true)) {
    return next();
  }
  return res.status(403).json({ 
    error: 'forbidden: admin access required',
    message: 'Your account lacks administrator privileges.'
  });
};

const requireSuperAdmin = (req, res, next) => {
  if (res.headersSent) return;
  if (req.user && req.user.role === 'super_admin') {
    return next();
  }
  return res.status(403).json({ 
    error: 'forbidden: super_admin access required',
    message: 'This operation requires Super Admin privileges.'
  });
};

module.exports = { protect, requireAdmin, requireSuperAdmin };
