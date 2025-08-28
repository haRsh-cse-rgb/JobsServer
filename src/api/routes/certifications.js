const express = require('express');
const router = express.Router();
const certificationsController = require('../controllers/certificationsController');
const auth = require('../middleware/auth');

// Public routes (no auth required)
router.get('/', certificationsController.getAllCertifications);
router.get('/category/:category', certificationsController.getCertificationsByCategory);
router.get('/:id', certificationsController.getCertificationById);

// Admin routes (auth required)
router.post('/', auth, certificationsController.createCertification);
router.put('/:id', auth, certificationsController.updateCertification);
router.delete('/:id', auth, certificationsController.deleteCertification);
router.post('/bulk-upload', auth, certificationsController.uploadMiddleware, certificationsController.bulkUploadCertifications);

module.exports = router; 