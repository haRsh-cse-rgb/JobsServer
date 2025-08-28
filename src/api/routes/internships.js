const express = require('express');
const router = express.Router();
const internshipsController = require('../controllers/internshipsController');
const auth = require('../middleware/auth');

// Public routes
router.get('/', internshipsController.getAllInternships);
router.get('/filters', internshipsController.getInternshipFilters);
router.get('/category/:category', internshipsController.getInternshipsByCategory);
// Bulk upload route must be before any /:id routes
router.post('/bulk-upload', auth, internshipsController.uploadMiddleware, internshipsController.bulkUploadInternships);
router.get('/:id', internshipsController.getInternshipById);

// Admin routes (protected)
router.post('/', auth, internshipsController.createInternship);
router.put('/:id', auth, internshipsController.updateInternship);
router.delete('/:id', auth, internshipsController.deleteInternship);

module.exports = router; 