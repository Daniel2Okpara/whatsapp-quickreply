const jwt = require('jsonwebtoken');

/**
 * Authentication Middleware
 * Fixes ERR_HTTP_HEADERS_SENT by ensuring every branch returns immediately.
 */
const protect = async (req, res, next) => {
  // 1. Guard: If headers were already sent, exit immediately.
  if (res.headersSent) return;

  const authHeader = req.headers.authorization;

  // 2. Branch: Token present
  if (authHeader && authHeader.startsWith('Bearer')) {
    try {
      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).json({ error: 'Not authorized, token missing' });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_production_key_2026');
      
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
