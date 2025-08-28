const express = require('express');
const router = express.Router();
const walkingController = require('../controllers/walkingController');
const authMiddleware = require('../middleware/auth');
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({ dest: '/tmp/' });

// Public routes
router.get('/', walkingController.getAllWalking);
router.get('/filters', walkingController.getWalkingFilters);
router.get('/category/:category', walkingController.getWalkingByCategory);
router.get('/:id', walkingController.getWalkingById);

// Admin routes (protected)
router.post('/', authMiddleware, walkingController.createWalking);
router.put('/:id', authMiddleware, walkingController.updateWalking);
router.delete('/:id', authMiddleware, walkingController.deleteWalking);
router.post('/bulk-upload', authMiddleware, upload.single('file'), walkingController.bulkUploadWalking);

module.exports = router; 