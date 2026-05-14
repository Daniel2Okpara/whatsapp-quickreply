const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

const protect = async (req, res, next) => {
  if (res.headersSent) return; // Safeguard against double responses

  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'Token missing' });

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_production_key_2026');
      
      req.user = await User.findById(decoded.id).select('-password');
      return next();
    } catch (error) {
      console.error('[Auth Middleware] Token validation failed:', error.message);
      return res.status(401).json({ error: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authorized, no token' });
  }
};

module.exports = { protect };
