const AWS = require('aws-sdk');
const axios = require('axios');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
const TABLE_NAME = process.env.WALKING_TABLE || 'walking';

// Configure multer for file uploads
const upload = multer({ dest: '/tmp/' });

// Helper function to get company logo
async function getCompanyLogo(companyName) {
  try {
    // Try to get logo from Clearbit API
    const response = await axios.get(`https://logo.clearbit.com/${companyName.toLowerCase().replace(/\s+/g, '')}.com`, {
      timeout: 5000,
      validateStatus: function (status) {
        return status < 500; // Accept all status codes less than 500
      }
    });
    
    if (response.status === 200) {
      return `https://logo.clearbit.com/${companyName.toLowerCase().replace(/\s+/g, '')}.com`;
    }
  } catch (error) {
    console.log(`Could not fetch logo for ${companyName}:`, error.message);
  }
  
  // Return placeholder if logo not found
  return '/placeholder-logo.svg';
}

// Get all walking opportunities
exports.getAllWalking = async (req, res) => {
  try {
    console.log('Getting all walking opportunities from table:', TABLE_NAME);
    
    const { category, location, q: searchTerm, page = 1, limit = 30 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const params = {
      TableName: TABLE_NAME,
      ScanIndexForward: false // Sort by postedAt descending
    };

    const result = await dynamodb.scan(params).promise();
    
    // Filter results based on query parameters
    let filteredItems = result.Items;
    
    if (category) {
      filteredItems = filteredItems.filter(item =>
        item.category && item.category.toLowerCase() === category.toLowerCase()
      );
    }
    
    if (location) {
      filteredItems = filteredItems.filter(item =>
        item.location && item.location.toLowerCase().includes(location.toLowerCase())
      );
    }
    
    // Case-insensitive search filter in Node.js
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filteredItems = filteredItems.filter(item => {
        return (
          (item.title && item.title.toLowerCase().includes(search)) ||
          (item.company && item.company.toLowerCase().includes(search)) ||
          (item.category && item.category.toLowerCase().includes(search)) ||
          (item.experience && item.experience.toLowerCase().includes(search))
        );
      });
    }
    
    // Add company logos to each walking opportunity
    const walkingWithLogos = await Promise.all(
      filteredItems.map(async (walking) => ({
        ...walking,
        companyLogo: await getCompanyLogo(walking.company)
      }))
    );

    // Apply pagination
    const totalItems = walkingWithLogos.length;
    const totalPages = Math.ceil(totalItems / limitNum);
    const paginatedItems = walkingWithLogos.slice(offset, offset + limitNum);

    res.json({
      success: true,
      walking: paginatedItems,
      count: paginatedItems.length,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Error fetching walking opportunities:', error);
    
    // Check if it's a table not found error
    if (error.code === 'ResourceNotFoundException') {
      return res.status(500).json({
        success: false,
        message: 'Walking table not found. Please ensure the DynamoDB table exists.',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch walking opportunities',
      error: error.message
    });
  }
};

// Get walking by ID
exports.getWalkingById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const params = {
      TableName: TABLE_NAME,
      Key: { id }
    };

    const result = await dynamodb.get(params).promise();
    
    if (!result.Item) {
      return res.status(404).json({
        success: false,
        message: 'Walking opportunity not found'
      });
    }

    // Add company logo
    const walking = {
      ...result.Item,
      companyLogo: await getCompanyLogo(result.Item.company)
    };

    res.json({
      success: true,
      walking
    });
  } catch (error) {
    console.error('Error fetching walking opportunity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch walking opportunity',
      error: error.message
    });
  }
};

// Create new walking opportunity
exports.createWalking = async (req, res) => {
  try {
    const {
      title,
      company,
      location,
      experience,
      category,
      date,
      time,
      applyLink
    } = req.body;

    if (!title || !company || !location || !experience || !category || !date || !time || !applyLink) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const walking = {
      id: uuidv4(),
      title,
      company,
      location,
      experience,
      category,
      date,
      time,
      applyLink,
      postedAt: new Date().toISOString()
    };

    const params = {
      TableName: TABLE_NAME,
      Item: walking
    };

    await dynamodb.put(params).promise();

    res.status(201).json({
      success: true,
      message: 'Walking opportunity created successfully',
      walking
    });
  } catch (error) {
    console.error('Error creating walking opportunity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create walking opportunity',
      error: error.message
    });
  }
};

// Update walking opportunity
exports.updateWalking = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Check if walking exists
    const getParams = {
      TableName: TABLE_NAME,
      Key: { id }
    };

    const existing = await dynamodb.get(getParams).promise();
    if (!existing.Item) {
      return res.status(404).json({
        success: false,
        message: 'Walking opportunity not found'
      });
    }

    // Update the walking opportunity
    const updatedWalking = {
      ...existing.Item,
      ...updateData
    };

    const params = {
      TableName: TABLE_NAME,
      Item: updatedWalking
    };

    await dynamodb.put(params).promise();

    res.json({
      success: true,
      message: 'Walking opportunity updated successfully',
      walking: updatedWalking
    });
  } catch (error) {
    console.error('Error updating walking opportunity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update walking opportunity',
      error: error.message
    });
  }
};

// Delete walking opportunity
exports.deleteWalking = async (req, res) => {
  try {
    const { id } = req.params;

    const params = {
      TableName: TABLE_NAME,
      Key: { id }
    };

    await dynamodb.delete(params).promise();

    res.json({
      success: true,
      message: 'Walking opportunity deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting walking opportunity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete walking opportunity',
      error: error.message
    });
  }
};

// Bulk upload walking opportunities from CSV
exports.bulkUploadWalking = async (req, res) => {
  try {
    console.log('Bulk upload request received');
    console.log('File:', req.file);
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const results = [];
    const errors = [];

    console.log('Starting CSV processing...');
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => {
        try {
          // Validate required fields
          if (!data.title || !data.company || !data.location || !data.experience || 
              !data.category || !data.date || !data.time || !data.applyLink) {
            errors.push({
              row: data,
              error: 'Missing required fields'
            });
            return;
          }

          const walking = {
            id: uuidv4(),
            title: data.title.trim(),
            company: data.company.trim(),
            location: data.location.trim(),
            experience: data.experience.trim(),
            category: data.category.trim(),
            date: data.date.trim(),
            time: data.time.trim(),
            applyLink: data.applyLink.trim(),
            postedAt: new Date().toISOString()
          };

          results.push(walking);
        } catch (error) {
          errors.push({
            row: data,
            error: error.message
          });
        }
      })
      .on('error', (error) => {
        console.error('Error reading CSV file:', error);
        res.status(500).json({
          success: false,
          message: 'Error reading CSV file',
          error: error.message
        });
      })
      .on('end', async () => {
        try {
          console.log(`CSV processing complete. Results: ${results.length}, Errors: ${errors.length}`);
          
          // Batch write to DynamoDB
          const batchSize = 25; // DynamoDB batch write limit
          for (let i = 0; i < results.length; i += batchSize) {
            const batch = results.slice(i, i + batchSize);
            const writeRequests = batch.map(item => ({
              PutRequest: {
                Item: item
              }
            }));

            const params = {
              RequestItems: {
                [TABLE_NAME]: writeRequests
              }
            };

            await dynamodb.batchWrite(params).promise();
          }

          // Clean up uploaded file
          fs.unlinkSync(req.file.path);

          res.json({
            success: true,
            message: `Successfully uploaded ${results.length} walking opportunities`,
            uploaded: results.length,
            errors: errors.length > 0 ? errors : undefined
          });
        } catch (error) {
          console.error('Error in bulk upload:', error);
          res.status(500).json({
            success: false,
            message: 'Failed to process bulk upload',
            error: error.message
          });
        }
      });
  } catch (error) {
    console.error('Error in bulk upload:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk upload',
      error: error.message
    });
  }
};

// Get walking opportunities by category
exports.getWalkingByCategory = async (req, res) => {
  try {
    const { category } = req.params;

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: '#category = :category',
      ExpressionAttributeNames: {
        '#category': 'category'
      },
      ExpressionAttributeValues: {
        ':category': category
      },
      ScanIndexForward: false
    };

    const result = await dynamodb.scan(params).promise();
    
    // Add company logos to each walking opportunity
    const walkingWithLogos = await Promise.all(
      result.Items.map(async (walking) => ({
        ...walking,
        companyLogo: await getCompanyLogo(walking.company)
      }))
    );

    res.json({
      success: true,
      walking: walkingWithLogos,
      count: walkingWithLogos.length,
      category
    });
  } catch (error) {
    console.error('Error fetching walking opportunities by category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch walking opportunities by category',
      error: error.message
    });
  }
};

// Get unique categories and locations for filters
exports.getWalkingFilters = async (req, res) => {
  try {
    const params = {
      TableName: TABLE_NAME
    };

    const result = await dynamodb.scan(params).promise();
    
    // Extract unique categories and locations
    const categories = [...new Set(result.Items.map(item => item.category).filter(Boolean))].sort();
    const locations = [...new Set(result.Items.map(item => item.location).filter(Boolean))].sort();

    res.json({
      success: true,
      categories,
      locations
    });
  } catch (error) {
    console.error('Error fetching walking filters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch walking filters',
      error: error.message
    });
  }
}; 