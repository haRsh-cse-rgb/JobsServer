const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');


const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const sarkariJobsController = {
  async getSarkariJobs(req, res) {
    try {
      const {
        page = 1,
        limit = 15,
        organization,
        q: searchTerm
      } = req.query;

      const offset = (page - 1) * limit;

      let params = {
        TableName: process.env.SARKARI_JOBS_TABLE,
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':active': 'active'
        }
      };

      if (organization) {
        params.FilterExpression += ' AND organization = :organization';
        params.ExpressionAttributeValues[':organization'] = organization;
      }

      const command = new ScanCommand(params);
      const result = await docClient.send(command);

      let sortedJobs = result.Items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      // Case-insensitive search filter in Node.js
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        sortedJobs = sortedJobs.filter(job => {
          return (
            (job.title && job.title.toLowerCase().includes(search)) ||
            (job.organization && job.organization.toLowerCase().includes(search)) ||
            (job.category && job.category.toLowerCase().includes(search))
          );
        });
      }

      const paginatedJobs = sortedJobs.slice(offset, offset + parseInt(limit));

      const response = {
        jobs: paginatedJobs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(sortedJobs.length / limit),
          totalJobs: sortedJobs.length,
          hasNext: offset + parseInt(limit) < sortedJobs.length,
          hasPrev: page > 1
        }
      };


      res.json(response);
    } catch (error) {
      console.error('Error fetching sarkari jobs:', error);
      res.status(500).json({ error: 'Failed to fetch sarkari jobs' });
    }
  },

  async getSarkariResults(req, res) {
    try {


      const params = {
        TableName: process.env.SARKARI_JOBS_TABLE,
        FilterExpression: '#status = :resultOut',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':resultOut': 'result-out'
        }
      };

      const command = new ScanCommand(params);
      const result = await docClient.send(command);

      const sortedResults = result.Items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));


      res.json(sortedResults);
    } catch (error) {
      console.error('Error fetching sarkari results:', error);
      res.status(500).json({ error: 'Failed to fetch sarkari results' });
    }
  },

  async getSarkariJobById(req, res) {
    try {
      const { id } = req.params;


      const params = {
        TableName: process.env.SARKARI_JOBS_TABLE,
        FilterExpression: 'jobId = :jobId',
        ExpressionAttributeValues: {
          ':jobId': id
        }
      };

      const command = new ScanCommand(params);
      const result = await docClient.send(command);

      if (!result.Items || result.Items.length === 0) {
        return res.status(404).json({ error: 'Sarkari job not found' });
      }

      const job = result.Items[0];

      res.json(job);
    } catch (error) {
      console.error('Error fetching sarkari job:', error);
      res.status(500).json({ error: 'Failed to fetch sarkari job' });
    }
  }
};

module.exports = sarkariJobsController;
