const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { protect } = require('../middleware/auth.middleware');

/**
 * Admin Access Control
 * All routes here require a valid JWT (checked by 'protect')
 * AND the user must have 'isAdmin: true' in the database.
 */
const adminOnly = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    return next();
  }
  
  // FALLBACK: Allow 'x-admin-secret' for legacy support or manual overrides
  const secret = process.env.ADMIN_SECRET;
  const header = req.headers['x-admin-secret'];
  if (secret && header && header === secret) {
    return next();
  }

  return res.status(403).json({ error: 'forbidden: admin access required' });
};

// Apply protection to all routes below
router.use(protect);
router.use(adminOnly);

// Endpoints
router.post('/cancel-subscription', adminController.cancelSubscription);
router.get('/users', adminController.listUsers);
router.get('/user/:email', adminController.getUser);
router.post('/simulate-webhook', adminController.simulateWebhook);
router.get('/webhook-logs', adminController.listWebhookLogs);

module.exports = router;
