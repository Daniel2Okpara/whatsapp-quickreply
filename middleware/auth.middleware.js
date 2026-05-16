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
      
      // Attach minimal user info
      req.user = { 
        id: decoded.id, 
        _id: decoded.id, 
        isAdmin: !!decoded.isAdmin 
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

module.exports = { protect };
