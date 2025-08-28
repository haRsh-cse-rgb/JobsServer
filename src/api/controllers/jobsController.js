const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const jobsController = {
  async getJobs(req, res) {
    try {
      // Debug: log the entire query object
      const {
        page = 1,
        limit = 15,
        category,
        location,
        batch,
        tags,
        q: searchTerm,
        role // <-- add this
      } = req.query;

      const offset = (page - 1) * limit;



      let params = {
        TableName: process.env.JOBS_TABLE,
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':active': 'active'
        }
      };

      // Add filters
      if (category) {
        params.FilterExpression += ' AND category = :category';
        params.ExpressionAttributeValues[':category'] = category;
      }

      if (location) {
        params.FilterExpression += ' AND contains(#location, :location)';
        params.ExpressionAttributeNames['#location'] = 'location';
        params.ExpressionAttributeValues[':location'] = location;
      }

      if (batch) {
        params.ExpressionAttributeNames['#batch'] = 'batch';
        if (batch === "Not Mentioned") {
          // Find jobs where batch is missing or empty
          params.FilterExpression += ' AND (attribute_not_exists(#batch) OR size(#batch) = :zero)';
          params.ExpressionAttributeValues[':zero'] = 0;
        } else {
          params.FilterExpression += ' AND contains(#batch, :batch)';
          params.ExpressionAttributeValues[':batch'] = batch;
        }
      }

      if (tags) {
        params.FilterExpression += ' AND contains(tags, :tags)';
        params.ExpressionAttributeValues[':tags'] = tags;
      }



      if (searchTerm) {
        // Note: DynamoDB's contains function is case-sensitive, so we perform
        // case-insensitive search in Node.js after fetching results

      }

      if (role) {
        params.FilterExpression += ' AND #role = :role';
        params.ExpressionAttributeNames['#role'] = 'role';
        params.ExpressionAttributeValues[':role'] = role;
      }

      const command = new ScanCommand(params);
      const result = await docClient.send(command);

      // Utility to unwrap DynamoDB attributes
      function unwrap(item) {
        const out = {};
        for (const key in item) {
          if (item[key] && typeof item[key] === 'object' && 'S' in item[key]) {
            out[key] = item[key].S;
          } else if (item[key] && typeof item[key] === 'object' && 'L' in item[key]) {
            out[key] = item[key].L.map(unwrap);
          } else {
            out[key] = item[key];
          }
        }
        return out;
      }

      // Unwrap all items
      let unwrappedJobs = result.Items.map(unwrap);
      let filteredJobs = unwrappedJobs.sort((a, b) => new Date(b.postedOn) - new Date(a.postedOn));

      // Debug logging
      console.log("Search term:", searchTerm);
      console.log("First 3 jobs before filtering:", filteredJobs.slice(0, 3).map(j => j.role));

      // Case-insensitive search filter in Node.js
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const normalizedSearch = search.replace(/[^a-z0-9 ]/gi, '');
        filteredJobs = filteredJobs.filter(job => {
          if (job.role) {
            const raw = job.role;
            const lower = job.role.toLowerCase();
            const norm = lower.replace(/[^a-z0-9 ]/gi, '');
            console.log("Comparing:", raw, "| lower:", lower, "| norm:", norm, "| type:", typeof job.role, "| search:", search, "| normSearch:", normalizedSearch);
          }
          return (
            (job.role && job.role.toLowerCase().replace(/[^a-z0-9 ]/gi, '').trim().includes(normalizedSearch)) ||
            (job.companyName && job.companyName.toLowerCase().replace(/[^a-z0-9 ]/gi, '').trim().includes(normalizedSearch))
          );
        });
        console.log("First 3 jobs after filtering:", filteredJobs.slice(0, 3).map(j => j.role));
      }

      // Paginate
      const paginatedJobs = filteredJobs.slice(offset, offset + parseInt(limit));

      const response = {
        jobs: paginatedJobs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(filteredJobs.length / limit),
          totalJobs: filteredJobs.length,
          hasNext: offset + parseInt(limit) < filteredJobs.length,
          hasPrev: page > 1
        }
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching jobs:', error);
      res.status(500).json({ error: 'Failed to fetch jobs' });
    }
  },

  async getJobById(req, res) {
    try {
      const { id } = req.params;



      // Since we need to search by jobId (sort key), we need to scan
      const params = {
        TableName: process.env.JOBS_TABLE,
        FilterExpression: 'jobId = :jobId',
        ExpressionAttributeValues: {
          ':jobId': id
        }
      };

      const command = new ScanCommand(params);
      const result = await docClient.send(command);

      if (!result.Items || result.Items.length === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const job = result.Items[0];

      res.json(job);
    } catch (error) {
      console.error('Error fetching job:', error);
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  }
};

module.exports = jobsController;
