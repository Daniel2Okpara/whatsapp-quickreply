const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');

router.post('/generate-replies', aiController.generateReplies);
router.post('/improve-message', aiController.improveMessage);

module.exports = router;
