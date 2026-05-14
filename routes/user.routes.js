const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');

router.get('/user-status', userController.getUserStatus);

module.exports = router;
