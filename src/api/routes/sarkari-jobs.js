const express = require('express');
const router = express.Router();
const sarkariJobsController = require('../controllers/sarkariJobsController');

// GET /api/v1/sarkari-jobs - Get paginated government jobs
router.get('/', sarkariJobsController.getSarkariJobs);

// GET /api/v1/sarkari-results - Get government jobs with result-out status
router.get('/results', sarkariJobsController.getSarkariResults);

// GET /api/v1/sarkari-jobs/:id - Get single sarkari job details
router.get('/:id', sarkariJobsController.getSarkariJobById);

module.exports = router;