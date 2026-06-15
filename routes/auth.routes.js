const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getProfile,
  verifyEmail,
  resendVerification,
  verificationStatus,
  requestEmailChange,
  confirmEmailChange,
  refresh,
  syncTemplates,
  getTemplates,
  updateFeatures,
  getFeatureMatrix,
  getExtensionLinks,
  wipeMyAccount,
  deleteAccount,
  startTrial,
  licenseStatus,
  getAccountStatus
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const handshakeController = require('../controllers/handshake.controller');

router.post('/register', register);
router.post('/login', login);
router.post('/resend-verification', resendVerification);
router.get('/verification-status', verificationStatus);
router.get('/verify-email', verifyEmail);
router.get('/account-status', getAccountStatus);
router.get('/profile', protect, getProfile);
router.post('/refresh', refresh);

// Email Change flow - Support both POST/PUT and legacy GET with query params
router.post('/request-email-change', protect, requestEmailChange);
router.put('/request-email-change', protect, requestEmailChange);
router.get('/request-email-change', protect, requestEmailChange);
router.post('/change-email', protect, requestEmailChange);
router.put('/change-email', protect, requestEmailChange);
router.get('/change-email', protect, requestEmailChange);
router.post('/email-change', protect, requestEmailChange);
router.put('/email-change', protect, requestEmailChange);
router.get('/email-change', protect, requestEmailChange);
router.get('/confirm-email-change', confirmEmailChange);
router.delete('/wipe-my-account', protect, wipeMyAccount);

// Handshake endpoints
router.post('/handshake/create', handshakeController.createHandshake);
router.get('/handshake/:token', handshakeController.consumeHandshake);

// Template Sync
router.post('/sync-templates', protect, syncTemplates);
router.get('/get-templates', protect, getTemplates);

// Features & Settings
router.post('/update-features', protect, updateFeatures);
router.get('/features', getFeatureMatrix);
router.get('/extension-links', getExtensionLinks);
router.delete('/delete-account', protect, deleteAccount);

// Trial and Licensing endpoints
router.post('/start-trial', protect, startTrial);
router.get('/license/status', protect, licenseStatus);

module.exports = router;
