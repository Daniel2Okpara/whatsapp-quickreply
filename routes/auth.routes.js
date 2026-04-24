const express = require('express');
const router = express.Router();
const { register, login, getProfile } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const handshakeController = require('../controllers/handshake.controller');

router.post('/register', register);
router.post('/login', login);
router.get('/profile', protect, getProfile);

// Handshake endpoints for landing -> extension connect
router.post('/handshake/create', handshakeController.createHandshake);
router.get('/handshake/:token', handshakeController.consumeHandshake);

// Template Sync Endpoints
router.post('/sync-templates', protect, require('../controllers/auth.controller').syncTemplates);
router.get('/get-templates', protect, require('../controllers/auth.controller').getTemplates);

module.exports = router;
