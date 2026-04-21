const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');

// Public AI endpoints used by the extension
router.post('/generate-replies', aiController.generateReplies);
router.post('/improve-message', aiController.improveMessage);

// Simpler compatibility endpoints requested by extension clients
router.post('/ai-reply', aiController.aiReply);
router.post('/ai-improve', aiController.aiImprove);

module.exports = router;
