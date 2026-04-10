const express = require('express');
const router = express.createElement ? express.Router() : express.Router(); 
const { register, login, getProfile } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

router.post('/register', register);
router.post('/login', login);
router.get('/profile', protect, getProfile);

module.exports = router;
