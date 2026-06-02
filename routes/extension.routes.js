const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

// Accept token via body or query for extension clients
const extensionTokenSupport = (req, res, next) => {
  if (!req.headers.authorization) {
    const token = req.body?.token || req.query?.token || req.headers['x-access-token'];
    if (token) req.headers.authorization = `Bearer ${token}`;
  }
  next();
};

// Public extension-compatible endpoints
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/resend-verification', authController.resendVerification);
router.get('/verification-status', authController.verificationStatus);
router.get('/verify-email', authController.verifyEmail);
router.get('/confirm-email-change', authController.confirmEmailChange);

// Protected endpoints (accept token via body/query)
router.post('/request-email-change', extensionTokenSupport, protect, authController.requestEmailChange);
router.put('/request-email-change', extensionTokenSupport, protect, authController.requestEmailChange);
router.get('/profile', extensionTokenSupport, protect, authController.getProfile);
router.post('/refresh', authController.refresh);

// Feature helpers
router.post('/update-features', extensionTokenSupport, protect, authController.updateFeatures);
router.get('/features', authController.getFeatureMatrix);

module.exports = router;
