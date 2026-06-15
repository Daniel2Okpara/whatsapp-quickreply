const express = require('express');
const router = express.Router();
const installController = require('../controllers/install.controller');

// Track Chrome Store installs
router.post('/track', installController.trackInstall);

// Link install to user after registration
router.post('/link', installController.linkInstallToUser);

// List all installs (admin only)
router.get('/list', installController.listInstalls);

// Get install statistics (admin only)
router.get('/stats', installController.getInstallStats);

module.exports = router;
