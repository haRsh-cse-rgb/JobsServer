const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, BatchWriteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const xlsx = require('xlsx');
const fs = require('fs');

const logActivity = require('../utils/activityLogger');

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

// Helper function to convert Excel serial date to JS Date
function excelDateToJSDate(serial) {
  // Check if it's already a proper date string
  if (typeof serial === 'string' && !isNaN(Date.parse(serial))) {
    return serial;
  }

  // Check if it's a number (Excel serial date)
  if (typeof serial === 'number') {
    // Excel serial date conversion
    // Excel's epoch starts on January 1, 1900
    // JavaScript's epoch starts on January 1, 1970
    // But Excel incorrectly treats 1900 as a leap year, so we need to adjust
    const excelEpoch = new Date(1900, 0, 1);
    const jsDate = new Date(excelEpoch.getTime() + (serial - 2) * 24 * 60 * 60 * 1000);
    return jsDate.toISOString().split('T')[0]; // Return YYYY-MM-DD format
  }

  // If it's already a string, return as is
  return serial;
}

const adminController = {
  async initializeAdmin() {
    try {
      // Check if admin already exists
      const params = {
        TableName: process.env.ADMINS_TABLE,
        Key: { email: process.env.ADMIN_EMAIL }
      };

      const command = new GetCommand(params);
      const result = await docClient.send(command);

      if (!result.Item) {
        // Create default admin user
        const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

        const adminData = {
          email: process.env.ADMIN_EMAIL,
          password: hashedPassword,
          role: 'superadmin',
          createdAt: new Date().toISOString()
        };

        const createParams = {
          TableName: process.env.ADMINS_TABLE,
          Item: adminData
        };

        const createCommand = new PutCommand(createParams);
        await docClient.send(createCommand);

        console.log('✅ Default admin user created');
      } else {
        console.log('✅ Admin user already exists');
      }
    } catch (error) {
      console.error('❌ Failed to initialize admin user:', error);
    }
  },

  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      // Get admin from database
      const params = {
        TableName: process.env.ADMINS_TABLE,
        Key: { email: email }
      };

      const command = new GetCommand(params);
      const result = await docClient.send(command);

      if (!result.Item) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const admin = result.Item;
      const isValidPassword = await bcrypt.compare(password, admin.password);

      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          email: admin.email,
          role: admin.role
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      res.json({
        message: 'Login successful',
        token: token,
        admin: {
          email: admin.email,
          role: admin.role
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  },

  async createJob(req, res) {
    try {
      const jobData = {
        ...req.body,
        jobId: uuidv4(),
        postedOn: new Date().toISOString(),
        status: 'active'
      };

      // Validate required fields
      const requiredFields = ['role', 'companyName', 'location', 'salary', 'jobDescription', 'originalLink', 'category', 'expiresOn'];
      for (const field of requiredFields) {
        if (!jobData[field]) {
          return res.status(400).json({ error: field + ' is required' });
        }
      }

      const params = {
        TableName: process.env.JOBS_TABLE,
        Item: jobData
      };

      const command = new PutCommand(params);
      await docClient.send(command);
      // Log activity
      if (req.admin && req.admin.email) {
        await logActivity({
          action: 'added',
          targetType: 'job',
          targetId: jobData.jobId,
          adminEmail: req.admin.email,
        });
      }

      res.status(201).json({ message: 'Job created successfully', job: jobData });
    } catch (error) {
      console.error('Error creating job:', error);
      res.status(500).json({ error: 'Failed to create job' });
    }
  },

  async bulkUploadJobs(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'File is required' });
      }

      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      const jobs = [];
      const errors = [];

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        try {
          const job = {
            jobId: uuidv4(),
            role: row.role,
            companyName: row.companyName,
            companyLogo: row.companyLogo,
            location: row.location,
            salary: row.salary,
            jobDescription: row.jobDescription,
            originalLink: row.originalLink,
            category: row.category,
            tags: row.tags ? (typeof row.tags === 'number' ? row.tags.toString().split(',').map(tag => tag.trim()) : row.tags.split(',').map(tag => tag.trim())) : [],
            batch: row.batch ? (typeof row.batch === 'number' ? row.batch.toString().split(',').map(batch => batch.trim()) : row.batch.split(',').map(batch => batch.trim())) : [],
            expiresOn: row.expiresOn,
            postedOn: new Date().toISOString(),
            status: 'active'
          };

          jobs.push(job);
        } catch (error) {
          errors.push({ row: i + 1, error: error.message });
        }
      }

      // Batch write to DynamoDB
      if (jobs.length > 0) {
        const batches = [];
        for (let i = 0; i < jobs.length; i += 25) {
          batches.push(jobs.slice(i, i + 25));
        }

        for (const batch of batches) {
          const params = {
            RequestItems: {
              [process.env.JOBS_TABLE]: batch.map(job => ({
                PutRequest: { Item: job }
              }))
            }
          };

          const command = new BatchWriteCommand(params);
          await docClient.send(command);
        }
      }

      // Clean up uploaded file
      fs.unlinkSync(req.file.path);

      res.json({
        message: 'Bulk upload completed',
        successful: jobs.length,
        errors: errors.length,
        errorDetails: errors
      });
    } catch (error) {
      console.error('Error in bulk upload:', error);
      res.status(500).json({ error: 'Bulk upload failed' });
    }
  },

  async updateJob(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // First, find the job to get the category (partition key)
      const scanParams = {
        TableName: process.env.JOBS_TABLE,
        FilterExpression: 'jobId = :jobId',
        ExpressionAttributeValues: {
          ':jobId': id
        }
      };

      const scanCommand = new ScanCommand(scanParams);
      const scanResult = await docClient.send(scanCommand);

      if (!scanResult.Items || scanResult.Items.length === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const existingJob = scanResult.Items[0];
      const newCategory = updates.category;
      const oldCategory = existingJob.category;

      // Check if category is being changed
      if (newCategory && newCategory !== oldCategory) {
        // Category is changing - we need to create a new item and delete the old one
        console.log('Moving job ' + id + ' from category "' + oldCategory + '" to "' + newCategory + '"');

        // Create new item with updated category
        const newJobData = {
          ...existingJob,
          ...updates,
          category: newCategory // Ensure the new category is set
        };

        // Put the new item
        const putParams = {
          TableName: process.env.JOBS_TABLE,
          Item: newJobData
        };
        const putCommand = new PutCommand(putParams);
        await docClient.send(putCommand);

        // Delete the old item
        const deleteParams = {
          TableName: process.env.JOBS_TABLE,
          Key: {
            category: oldCategory,
            jobId: id
          }
        };
        const deleteCommand = new DeleteCommand(deleteParams);
        await docClient.send(deleteCommand);

        // Log activity
        if (req.admin && req.admin.email) {
          await logActivity({
            action: 'updated',
            targetType: 'job',
            targetId: id,
            adminEmail: req.admin.email,
          });
        }



        res.json({
          message: `Job updated successfully and moved from "${oldCategory}" to "${newCategory}"`,
          job: newJobData
        });
      } else {
        // Category is not changing - do normal update
        // Build update expression
        let updateExpression = 'SET ';
        const expressionAttributeNames = {};
        const expressionAttributeValues = {};

        Object.keys(updates).forEach((key, index) => {
          if (key !== 'jobId' && key !== 'category') { // Don't update keys
            updateExpression += `#${key} = :${key}`;
            if (index < Object.keys(updates).length - 1) updateExpression += ', ';
            expressionAttributeNames[`#${key}`] = key;
            expressionAttributeValues[`:${key}`] = updates[key];
          }
        });

        const params = {
          TableName: process.env.JOBS_TABLE,
          Key: {
            category: existingJob.category,
            jobId: id
          },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_NEW'
        };

        const command = new UpdateCommand(params);
        const result = await docClient.send(command);

        // Log activity
        if (req.admin && req.admin.email) {
          await logActivity({
            action: 'updated',
            targetType: 'job',
            targetId: id,
            adminEmail: req.admin.email,
          });
        }




        res.json({ message: 'Job updated successfully', job: result.Attributes });
      }
    } catch (error) {
      console.error('Error updating job:', error);
      res.status(500).json({ error: 'Failed to update job' });
    }
  },

  async deleteJob(req, res) {
    try {
      const { id } = req.params;

      // First, find the job to get the category (partition key)
      const scanParams = {
        TableName: process.env.JOBS_TABLE,
        FilterExpression: 'jobId = :jobId',
        ExpressionAttributeValues: {
          ':jobId': id
        }
      };

      const scanCommand = new ScanCommand(scanParams);
      const scanResult = await docClient.send(scanCommand);

      if (!scanResult.Items || scanResult.Items.length === 0) {
        // If not found, treat as already deleted (idempotent)
        return res.json({ message: 'Job deleted successfully (not found, already deleted)' });
      }

      // There could be multiple jobs with the same jobId in different categories (shouldn't happen, but handle it)
      for (const job of scanResult.Items) {
        const params = {
          TableName: process.env.JOBS_TABLE,
          Key: {
            category: job.category,
            jobId: id
          }
        };
        const command = new DeleteCommand(params);
        await docClient.send(command);
      }



      // Log activity
      if (req.admin && req.admin.email) {
        await logActivity({
          action: 'deleted',
          targetType: 'job',
          targetId: id,
          adminEmail: req.admin.email,
        });
      }

      res.json({ message: 'Job deleted successfully' });
    } catch (error) {
      console.error('Error deleting job:', error);
      res.status(500).json({ error: 'Failed to delete job' });
    }
  },

  async createSarkariJob(req, res) {
    try {
      const jobData = {
        ...req.body,
        jobId: uuidv4(),
        postedOn: new Date().toISOString(),
        status: 'active'
      };

      const requiredFields = ['postName', 'organization', 'officialWebsite', 'notificationLink'];
      for (const field of requiredFields) {
        if (!jobData[field]) {
          return res.status(400).json({ error: `${field} is required` });
        }
      }

      const params = {
        TableName: process.env.SARKARI_JOBS_TABLE,
        Item: jobData
      };

      const command = new PutCommand(params);
      await docClient.send(command);
      // Log activity
      if (req.admin && req.admin.email) {
        await logActivity({
          action: 'added',
          targetType: 'sarkari-job',
          targetId: jobData.jobId,
          adminEmail: req.admin.email,
        });
      }

      res.status(201).json({ message: 'Sarkari job created successfully', job: jobData });
    } catch (error) {
      console.error('Error creating sarkari job:', error);
      res.status(500).json({ error: 'Failed to create sarkari job' });
    }
  },

  async bulkUploadSarkariJobs(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'File is required' });
      }

      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      const jobs = [];
      const errors = [];

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        try {
          // Process dates properly
          const importantDates = {};

          if (row.applicationStart !== undefined) {
            importantDates.applicationStart = excelDateToJSDate(row.applicationStart);
          }

          if (row.applicationEnd !== undefined) {
            importantDates.applicationEnd = excelDateToJSDate(row.applicationEnd);
          }

          if (row.examDate !== undefined) {
            importantDates.examDate = excelDateToJSDate(row.examDate);
          }

          const job = {
            jobId: uuidv4(),
            postName: row.postName,
            organization: row.organization,
            advertisementNo: row.advertisementNo,
            importantDates: importantDates,
            applicationFee: row.applicationFee,
            vacancyDetails: row.vacancyDetails,
            eligibility: row.eligibility,
            officialWebsite: row.officialWebsite,
            notificationLink: row.notificationLink,
            applyLink: row.applyLink,
            resultLink: row.resultLink,
            createdAt: new Date().toISOString(),
            status: 'active'
          };

          jobs.push(job);
        } catch (error) {
          errors.push({ row: i + 1, error: error.message });
        }
      }

      // Batch write to DynamoDB
      if (jobs.length > 0) {
        const batches = [];
        for (let i = 0; i < jobs.length; i += 25) {
          batches.push(jobs.slice(i, i + 25));
        }

        for (const batch of batches) {
          const params = {
            RequestItems: {
              [process.env.SARKARI_JOBS_TABLE]: batch.map(job => ({
                PutRequest: { Item: job }
              }))
            }
          };

          const command = new BatchWriteCommand(params);
          await docClient.send(command);
        }
      }

      fs.unlinkSync(req.file.path);

      res.json({
        message: 'Sarkari jobs bulk upload completed',
        successful: jobs.length,
        errors: errors.length,
        errorDetails: errors
      });
    } catch (error) {
      console.error('Error in sarkari jobs bulk upload:', error);
      res.status(500).json({ error: 'Sarkari jobs bulk upload failed' });
    }
  },

  async updateSarkariJob(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Find the job first
      const scanParams = {
        TableName: process.env.SARKARI_JOBS_TABLE,
        FilterExpression: 'jobId = :jobId',
        ExpressionAttributeValues: {
          ':jobId': id
        }
      };

      const scanCommand = new ScanCommand(scanParams);
      const scanResult = await docClient.send(scanCommand);

      if (!scanResult.Items || scanResult.Items.length === 0) {
        return res.status(404).json({ error: 'Sarkari job not found' });
      }

      const existingJob = scanResult.Items[0];

      let updateExpression = 'SET ';
      const expressionAttributeNames = {};
      const expressionAttributeValues = {};

      Object.keys(updates).forEach((key, index) => {
        if (key !== 'jobId' && key !== 'organization') {
          updateExpression += `#${key} = :${key}`;
          if (index < Object.keys(updates).length - 1) updateExpression += ', ';
          expressionAttributeNames[`#${key}`] = key;
          expressionAttributeValues[`:${key}`] = updates[key];
        }
      });

      const params = {
        TableName: process.env.SARKARI_JOBS_TABLE,
        Key: {
          organization: existingJob.organization,
          jobId: id
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW'
      };

      const command = new UpdateCommand(params);
      const result = await docClient.send(command);
      // Log activity
      if (req.admin && req.admin.email) {
        await logActivity({
          action: 'updated',
          targetType: 'sarkari-job',
          targetId: id,
          adminEmail: req.admin.email,
        });
      }




      res.json({ message: 'Sarkari job updated successfully', job: result.Attributes });
    } catch (error) {
      console.error('Error updating sarkari job:', error);
      res.status(500).json({ error: 'Failed to update sarkari job' });
    }
  },

  async deleteSarkariJob(req, res) {
    try {
      const { id } = req.params;

      const scanParams = {
        TableName: process.env.SARKARI_JOBS_TABLE,
        FilterExpression: 'jobId = :jobId',
        ExpressionAttributeValues: {
          ':jobId': id
        }
      };

      const scanCommand = new ScanCommand(scanParams);
      const scanResult = await docClient.send(scanCommand);

      if (!scanResult.Items || scanResult.Items.length === 0) {
        return res.status(404).json({ error: 'Sarkari job not found' });
      }

      const job = scanResult.Items[0];

      const params = {
        TableName: process.env.SARKARI_JOBS_TABLE,
        Key: {
          organization: job.organization,
          jobId: id
        }
      };

      const command = new DeleteCommand(params);
      await docClient.send(command);



      // Log activity
      if (req.admin && req.admin.email) {
        await logActivity({
          action: 'deleted',
          targetType: 'sarkari-job',
          targetId: id,
          adminEmail: req.admin.email,
        });
      }

      res.json({ message: 'Sarkari job deleted successfully' });
    } catch (error) {
      console.error('Error deleting sarkari job:', error);
      res.status(500).json({ error: 'Failed to delete sarkari job' });
    }
  },

  async createAdmin(req, res) {
    try {
      const { email, password, role } = req.body;
      if (!email || !password || !role) {
        return res.status(400).json({ error: 'Email, password, and role are required' });
      }
      // Check if admin already exists
      const params = {
        TableName: process.env.ADMINS_TABLE,
        Key: { email }
      };
      const command = new GetCommand(params);
      const result = await docClient.send(command);
      if (result.Item) {
        return res.status(409).json({ error: 'Admin with this email already exists' });
      }
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      const adminData = {
        email,
        password: hashedPassword,
        role,
        createdAt: new Date().toISOString()
      };
      const createParams = {
        TableName: process.env.ADMINS_TABLE,
        Item: adminData
      };
      const createCommand = new PutCommand(createParams);
      await docClient.send(createCommand);
      res.status(201).json({ message: 'Admin created successfully', admin: { email, role } });
    } catch (error) {
      console.error('Error creating admin:', error);
      res.status(500).json({ error: 'Failed to create admin' });
    }
  },

  async getStats(req, res) {
    try {
      // Count private jobs
      const jobsParams = {
        TableName: process.env.JOBS_TABLE,
      };
      const jobsCommand = new ScanCommand(jobsParams);
      const jobsResult = await docClient.send(jobsCommand);
      const totalPrivateJobs = jobsResult.Items ? jobsResult.Items.length : 0;
      const activePrivateJobs = jobsResult.Items ? jobsResult.Items.filter(j => j.status === 'active').length : 0;

      // Count government jobs
      const sarkariParams = {
        TableName: process.env.SARKARI_JOBS_TABLE,
      };
      const sarkariCommand = new ScanCommand(sarkariParams);
      const sarkariResult = await docClient.send(sarkariCommand);
      const totalGovtJobs = sarkariResult.Items ? sarkariResult.Items.length : 0;
      const activeGovtJobs = sarkariResult.Items ? sarkariResult.Items.filter(j => j.status === 'active').length : 0;

      // Count internships
      let totalInternships = 0;
      let activeInternships = 0;
      if (process.env.INTERNSHIPS_TABLE) {
        const internParams = {
          TableName: process.env.INTERNSHIPS_TABLE,
        };
        const internCommand = new ScanCommand(internParams);
        const internResult = await docClient.send(internCommand);
        totalInternships = internResult.Items ? internResult.Items.length : 0;
        activeInternships = internResult.Items ? internResult.Items.filter(i => i.isActive === true).length : 0;
      }

      // Count walking
      let totalWalking = 0;
      let activeWalking = 0;
      if (process.env.WALKING_TABLE) {
        const walkingParams = {
          TableName: process.env.WALKING_TABLE,
        };
        const walkingCommand = new ScanCommand(walkingParams);
        const walkingResult = await docClient.send(walkingCommand);
        totalWalking = walkingResult.Items ? walkingResult.Items.length : 0;
        activeWalking = walkingResult.Items ? walkingResult.Items.filter(w => w.isActive === true).length : 0;
      }

      // Count certifications
      let totalCertifications = 0;
      if (process.env.CERTIFICATIONS_TABLE) {
        const certParams = {
          TableName: process.env.CERTIFICATIONS_TABLE,
        };
        const certCommand = new ScanCommand(certParams);
        const certResult = await docClient.send(certCommand);
        totalCertifications = certResult.Items ? certResult.Items.length : 0;
      }

      // Count subscriptions
      let totalSubscriptions = 0;
      if (process.env.SUBSCRIPTIONS_TABLE) {
        const subsParams = {
          TableName: process.env.SUBSCRIPTIONS_TABLE,
        };
        const subsCommand = new ScanCommand(subsParams);
        const subsResult = await docClient.send(subsCommand);
        totalSubscriptions = subsResult.Items ? subsResult.Items.length : 0;
      }

      res.json({
        totalPrivateJobs,
        activePrivateJobs,
        totalGovtJobs,
        activeGovtJobs,
        totalInternships,
        activeInternships,
        totalWalking,
        activeWalking,
        totalCertifications,
        totalSubscriptions
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
  },

  async getRecentActivity(req, res) {
    try {
      const AWS = require('aws-sdk');
      const dynamoDb = new AWS.DynamoDB.DocumentClient();
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const params = {
        TableName: 'AdminActivities',
      };
      const data = await dynamoDb.scan(params).promise();
      const sorted = data.Items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const total = sorted.length;
      const start = (page - 1) * limit;
      const end = start + limit;
      const activities = sorted.slice(start, end);
      res.json({
        activities,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        limit,
      });
    } catch (error) {
      console.error('Error fetching recent activities:', error);
      res.status(500).json({ error: 'Failed to fetch recent activities' });
    }
  }
};

module.exports = adminController;
