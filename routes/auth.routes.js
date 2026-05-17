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
  wipeMyAccount
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const handshakeController = require('../controllers/handshake.controller');

router.post('/register', register);
router.post('/login', login);
router.post('/resend-verification', resendVerification);
router.get('/verification-status', verificationStatus);
router.get('/verify-email', verifyEmail);
router.get('/profile', protect, getProfile);
router.post('/refresh', refresh);

// Email Change flow
router.post('/request-email-change', protect, requestEmailChange);
router.get('/confirm-email-change', confirmEmailChange);
router.delete('/wipe-my-account', protect, wipeMyAccount);

// Handshake endpoints
router.post('/handshake/create', handshakeController.createHandshake);
router.get('/handshake/:token', handshakeController.consumeHandshake);

// Template Sync
router.post('/sync-templates', protect, syncTemplates);
router.get('/get-templates', protect, getTemplates);

module.exports = router;
