const express = require('express');
const router = express.Router();
const s3Controller = require('../controllers/s3Controller');

// GET /api/v1/s3/pre-signed-url - Get pre-signed URL for CV upload
router.get('/pre-signed-url', s3Controller.getPreSignedUrl);

module.exports = router;