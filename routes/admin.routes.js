const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');

// Simple admin protection using header x-admin-secret
router.post('/cancel-subscription', (req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  const header = req.headers['x-admin-secret'];
  if (!secret || !header || header !== secret) return res.status(401).json({ error: 'unauthorized' });
  next();
}, adminController.cancelSubscription);

module.exports = router;
