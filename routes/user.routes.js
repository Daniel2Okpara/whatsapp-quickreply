const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');

router.get('/user-status', userController.getUserStatus);
router.post('/user/update-email', userController.updateEmail);

module.exports = router;
