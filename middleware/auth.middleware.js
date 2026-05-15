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
        console.warn('[Auth Failed]: Token missing in Bearer header');
        return res.status(401).json({ error: 'Not authorized, token missing' });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_production_key_2026');
      
      // Store user info from token (including isAdmin role)
      req.user = { 
        id: decoded.id, 
        _id: decoded.id, 
        isAdmin: decoded.isAdmin || false 
      };
      
      console.log(`[JWT Auth]: User ${decoded.id} authenticated. Role: ${decoded.isAdmin ? 'ADMIN' : 'User'}`);

      // Optional: Fetch full user if needed for specific controller logic (e.g. email change)
      // We do this inside controllers to keep the middleware fast.
      
      return next();

    } catch (error) {
      console.error('[Auth Failed]:', error.message);
      return res.status(401).json({ error: 'Not authorized, token failed' });
    }
  }

  // 2. No token found: send error and RETURN
  if (!token) {
    console.warn('[Auth Failed]: No Authorization header present');
    return res.status(401).json({ error: 'Not authorized, no token' });
  }
};

module.exports = { protect };
