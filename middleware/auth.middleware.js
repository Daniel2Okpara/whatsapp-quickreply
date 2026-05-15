const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

/**
 * Authentication Middleware
 * Standard Express implementation with strict return-on-response flow.
 */
const protect = async (req, res, next) => {
  // Safety check: if headers were already sent by previous middleware (rate limiters, etc.)
  if (res.headersSent) return;

  let token;

  // 1. Check for Bearer token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({ error: 'Not authorized, token missing' });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_production_key_2026');
      
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) {
        return res.status(401).json({ error: 'Not authorized, user not found' });
      }

      // Successful authentication: call next() and RETURN immediately
      return next();

    } catch (error) {
      console.error('[Auth Middleware] Token error:', error.message);
      return res.status(401).json({ error: 'Not authorized, token failed' });
    }
  }

  // 2. No token found: send error and RETURN
  if (!token) {
    return res.status(401).json({ error: 'Not authorized, no token' });
  }
};

module.exports = { protect };
