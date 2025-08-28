const express = require('express');
const router = express.Router();
const jobsController = require('../controllers/jobsController');

// GET /api/v1/jobs - Get paginated jobs with filters
router.get('/', jobsController.getJobs);

// GET /api/v1/jobs/:id - Get single job details
router.get('/:id', jobsController.getJobById);

module.exports = router;