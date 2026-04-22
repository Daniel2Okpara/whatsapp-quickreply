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
  const secret = process.env.ADMIN_SECRET;
  const header = req.headers['x-admin-secret'];

  // Check 1: User has 'isAdmin' in their JWT
  if (req.user && req.user.isAdmin === true) {
    return next();
  }
  
  // Check 2: Fallback to Secret Header (Safety Bypass)
  if (secret && header && header === secret) {
    console.log('[Admin] Access granted via Secret Header.');
    return next();
  }

  console.error('[Admin] Forbidden: User is not an admin.', { email: req.user?.email });
  return res.status(403).json({ 
    error: 'forbidden: admin access required',
    message: 'Your account lacks administrator privileges. Please register as the first user or provide the Admin Secret.'
  });
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
router.post('/delete-user', adminController.deleteUser);
router.post('/update-admin', adminController.updateAdmin);

module.exports = router;
