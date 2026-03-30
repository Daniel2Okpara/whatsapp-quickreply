const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');

router.post('/generate-replies', aiController.generateReplies);

module.exports = router;
