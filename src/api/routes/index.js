const express = require('express');
const router = express.Router();

// Import all route modules
const jobsRoutes = require('./jobs');
const sarkariJobsRoutes = require('./sarkari-jobs');
const adminRoutes = require('./admin');
const aiRoutes = require('./ai');
const s3Routes = require('./s3');
const subscriptionRoutes = require('./subscription');
const certificationsRoutes = require('./certifications');
const internshipsRoutes = require('./internships');
const walkingRoutes = require('./walking');

// Use the routes
router.use('/jobs', jobsRoutes);
router.use('/sarkari-jobs', sarkariJobsRoutes);
router.use('/admin', adminRoutes);
router.use('/ai', aiRoutes);
router.use('/s3', s3Routes);
router.use('/subscription', subscriptionRoutes);
router.use('/certifications', certificationsRoutes);
router.use('/internships', internshipsRoutes);
router.use('/walking', walkingRoutes);

module.exports = router;