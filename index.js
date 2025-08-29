const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://india-jobs.in'] 
    : ['http://localhost:3000'],
  credentials: true
}));

// Rate limiting - more restrictive for sensitive endpoints
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Apply rate limiting to sensitive endpoints
app.use('/api/v1/admin', sensitiveLimiter);
app.use('/api/v1/ai', sensitiveLimiter);
app.use('/api/v1/s3', sensitiveLimiter);

// More lenient rate limiting for public endpoints
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Apply to public endpoints
app.use('/api/v1/jobs', publicLimiter);
app.use('/api/v1/internships', publicLimiter);
app.use('/api/v1/sarkari-jobs', publicLimiter);
app.use('/api/v1/certifications', publicLimiter);
app.use('/api/v1/walking', publicLimiter);

const analyzeCvLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1, // limit each IP to 1 request per windowMs
  message: 'One Cv Analysis per minute, please try again later after 1 minute'
});
app.use('/api/v1/ai/analyze-cv', analyzeCvLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Pre-initialize controllers to avoid cold start delays
console.log('🚀 Pre-initializing controllers...');
const jobsController = require('./src/api/controllers/jobsController');
const internshipsController = require('./src/api/controllers/internshipsController');
const certificationsController = require('./src/api/controllers/certificationsController');
const walkingController = require('./src/api/controllers/walkingController');
const sarkariJobsController = require('./src/api/controllers/sarkariJobsController');
console.log('✅ Controllers pre-initialized');

// API Routes
app.use('/api/v1', require('./src/api/routes'));

// Initialize admin user
const adminController = require('./src/api/controllers/adminController');

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 JobQuest API Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API Base URL: http://localhost:${PORT}/api/v1`);
  
  // Initialize admin user
  await adminController.initializeAdmin();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});