const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

const protect = async (req, res, next) => {
  // 1. Prevents double-execution on the same request object
  if (req._auth_run || res.headersSent) {
    return next();
  }
  req._auth_run = true;

  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'Token missing' });

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_production_key_2026');
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) return res.status(401).json({ error: 'User not found' });
      
      return next();
    } catch (error) {
      console.error('[Auth Middleware] Validation error:', error.message);
      return res.status(401).json({ error: 'Not authorized' });
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
};

module.exports = { protect };
