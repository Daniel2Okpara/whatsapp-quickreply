const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { protect } = require('../middleware/auth.middleware');

router.post('/generate-replies', protect, aiController.generateReplies);
router.post('/improve-message', protect, aiController.improveMessage);

module.exports = router;
