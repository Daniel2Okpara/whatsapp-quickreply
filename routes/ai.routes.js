const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// Public AI endpoints used by the extension
router.post('/generate-replies', aiController.generateReplies);
router.post('/improve-message', aiController.improveMessage);
router.post('/transcribe', upload.single('audio'), aiController.transcribeAudio);

// Simpler compatibility endpoints requested by extension clients
router.post('/ai-reply', aiController.aiReply);
router.post('/ai-improve', aiController.aiImprove);
router.post('/ai-feedback', aiController.submitFeedback);

module.exports = router;
