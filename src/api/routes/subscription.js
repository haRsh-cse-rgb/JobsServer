const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');

// POST /api/v1/subscribe - Subscribe to newsletter
router.post('/', subscriptionController.subscribe);

module.exports = router;