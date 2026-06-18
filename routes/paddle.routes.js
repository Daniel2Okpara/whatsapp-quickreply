const express = require('express');
const router = express.Router();
const paddleController = require('../controllers/paddle.controller');

// Note: this route expects raw body (form-encoded) from Paddle
router.post('/webhook/paddle', paddleController.handleWebhook);

module.exports = router;
