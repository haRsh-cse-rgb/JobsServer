const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth');
const multer = require('multer');

const upload = multer({ dest: 'uploads/' });

// POST /api/v1/admin/login - Admin login
router.post('/login', adminController.login);

// Protected admin routes
router.use(authMiddleware);

// Dashboard stats
router.get('/stats', adminController.getStats);

// Recent activity
router.get('/recent-activity', adminController.getRecentActivity);

// Admin management
router.post('/admins', adminController.createAdmin);

// Jobs management
router.post('/jobs', adminController.createJob);
router.post('/jobs/bulk', upload.single('file'), adminController.bulkUploadJobs);
router.put('/jobs/:id', adminController.updateJob);
router.delete('/jobs/:id', adminController.deleteJob);

// Sarkari jobs management
router.post('/sarkari-jobs', adminController.createSarkariJob);
router.post('/sarkari-jobs/bulk', upload.single('file'), adminController.bulkUploadSarkariJobs);
router.put('/sarkari-jobs/:id', adminController.updateSarkariJob);
router.delete('/sarkari-jobs/:id', adminController.deleteSarkariJob);

module.exports = router;