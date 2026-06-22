const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const installController = require('../controllers/install.controller');
const { protect, requireAdmin, requireSuperAdmin } = require('../middleware/auth.middleware');

// All routes require authentication
router.use(protect);

// 1. Any authenticated user can request admin access
router.post('/request-access', adminController.requestAccess);

// 2. Admin & Super Admin routes
router.get('/users', requireAdmin, adminController.listUsers);
router.get('/user/:email', requireAdmin, adminController.getUser);
router.post('/cancel-subscription', requireAdmin, adminController.cancelSubscription);
router.post('/upgrade-plan', requireAdmin, adminController.upgradePlan);
router.post('/downgrade-plan', requireAdmin, adminController.downgradeplan);
router.post('/simulate-webhook', requireAdmin, adminController.simulateWebhook);
router.get('/webhook-logs', requireAdmin, adminController.listWebhookLogs);
router.get('/feedback-stats', requireAdmin, adminController.getFeedbackStats);

// Device management routes (Admin only)
router.get('/devices', requireAdmin, adminController.listDevices);
router.post('/clear-devices', requireSuperAdmin, adminController.clearDevices);

// Install tracking routes (Admin only)
router.get('/installs', requireAdmin, installController.listInstalls);
router.get('/install-stats', requireAdmin, installController.getInstallStats);

// 3. Super Admin only routes
router.get('/pending-requests', requireSuperAdmin, adminController.getPendingRequests);
router.post('/approve-request', requireSuperAdmin, adminController.approveRequest);
router.post('/reject-request', requireSuperAdmin, adminController.rejectRequest);
router.post('/promote-super-admin', requireSuperAdmin, adminController.promoteSuperAdmin);
router.post('/demote-admin', requireSuperAdmin, adminController.demoteAdmin);
router.post('/delete-user', requireSuperAdmin, adminController.deleteUser);
router.post('/update-admin', requireSuperAdmin, adminController.updateAdmin);

module.exports = router;
