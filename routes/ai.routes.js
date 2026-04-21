const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');

// AI endpoints are intentionally public — server will use server-side OPENAI_API_KEY
// when a client API key is not provided. Removing authentication middleware
// allows the extension background worker to call AI without a JWT.
router.post('/generate-replies', aiController.generateReplies);
router.post('/improve-message', aiController.improveMessage);

module.exports = router;
