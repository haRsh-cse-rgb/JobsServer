const AWS = require('aws-sdk');
const axios = require('axios');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.CERTIFICATIONS_TABLE || 'certifications';

// Configure multer for file uploads
const upload = multer({ dest: '/tmp/' });

// Helper function to get provider logo
async function getProviderLogo(providerName) {
  try {
    // Try to get logo from Clearbit API
    const response = await axios.get(`https://logo.clearbit.com/${providerName.toLowerCase().replace(/\s+/g, '')}.com`, {
      timeout: 5000,
      validateStatus: function (status) {
        return status < 500; // Accept all status codes less than 500
      }
    });
    
    if (response.status === 200) {
      return `https://logo.clearbit.com/${providerName.toLowerCase().replace(/\s+/g, '')}.com`;
    }
  } catch (error) {
    console.log(`Could not fetch logo for ${providerName}:`, error.message);
  }
  
  // Return placeholder if logo not found
  return '/placeholder-logo.svg';
}

// Get all certifications
exports.getAllCertifications = async (req, res) => {
  try {
    const { q: searchTerm } = req.query;
    
    const params = {
      TableName: TABLE_NAME,
      ScanIndexForward: false // Sort by postedAt descending
    };

    const result = await dynamodb.scan(params).promise();
    
    let certifications = result.Items || [];
    
    // Case-insensitive search filter in Node.js
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      certifications = certifications.filter(cert => {
        return (
          (cert.title && cert.title.toLowerCase().includes(search)) ||
          (cert.provider && cert.provider.toLowerCase().includes(search)) ||
          (cert.category && cert.category.toLowerCase().includes(search))
        );
      });
    }
    
    // Add provider logos to each certification
    const certificationsWithLogos = await Promise.all(
      certifications.map(async (cert) => ({
        ...cert,
        providerLogo: await getProviderLogo(cert.provider)
      }))
    );

    res.json({
      success: true,
      certifications: certificationsWithLogos,
      count: certificationsWithLogos.length
    });
  } catch (error) {
    console.error('Error fetching certifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch certifications',
      error: error.message
    });
  }
};

// Get certification by ID
exports.getCertificationById = async (req, res) => {
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
        message: 'Certification not found'
      });
    }

    // Add provider logo
    const certification = {
      ...result.Item,
      providerLogo: await getProviderLogo(result.Item.provider)
    };

    res.json({
      success: true,
      certification
    });
  } catch (error) {
    console.error('Error fetching certification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch certification',
      error: error.message
    });
  }
};

// Create new certification
exports.createCertification = async (req, res) => {
  try {
    const { title, provider, category, link } = req.body;
    
    if (!title || !provider || !category || !link) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, provider, category, link'
      });
    }

    const now = new Date().toISOString();
    const certification = {
      id: `cert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title,
      provider,
      category,
      link,
      postedAt: now,
      lastUpdated: now
    };

    const params = {
      TableName: TABLE_NAME,
      Item: certification
    };

    await dynamodb.put(params).promise();

    res.status(201).json({
      success: true,
      message: 'Certification created successfully',
      certification
    });
  } catch (error) {
    console.error('Error creating certification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create certification',
      error: error.message
    });
  }
};

// Update certification
exports.updateCertification = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, provider, category, link } = req.body;
    
    if (!title || !provider || !category || !link) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, provider, category, link'
      });
    }

    const params = {
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: 'SET title = :title, provider = :provider, category = :category, link = :link, lastUpdated = :lastUpdated',
      ExpressionAttributeValues: {
        ':title': title,
        ':provider': provider,
        ':category': category,
        ':link': link,
        ':lastUpdated': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamodb.update(params).promise();

    res.json({
      success: true,
      message: 'Certification updated successfully',
      certification: result.Attributes
    });
  } catch (error) {
    console.error('Error updating certification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update certification',
      error: error.message
    });
  }
};

// Delete certification
exports.deleteCertification = async (req, res) => {
  try {
    const { id } = req.params;
    
    const params = {
      TableName: TABLE_NAME,
      Key: { id }
    };

    await dynamodb.delete(params).promise();

    res.json({
      success: true,
      message: 'Certification deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting certification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete certification',
      error: error.message
    });
  }
};

// Bulk upload certifications from CSV
exports.bulkUploadCertifications = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const certifications = [];
    
    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
          if (row.title && row.provider && row.category && row.link) {
            certifications.push({
              title: row.title.trim(),
              provider: row.provider.trim(),
              category: row.category.trim(),
              link: row.link.trim()
            });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    if (certifications.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid certifications found in CSV file'
      });
    }

    if (certifications.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 1000 certifications allowed per upload'
      });
    }

    const now = new Date().toISOString();
    const certificationsToUpload = certifications.map(cert => ({
      id: `cert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: cert.title,
      provider: cert.provider,
      category: cert.category,
      link: cert.link,
      postedAt: now,
      lastUpdated: now
    }));

    // Batch write to DynamoDB (25 items per batch)
    const batchSize = 25;
    const batches = [];
    
    for (let i = 0; i < certificationsToUpload.length; i += batchSize) {
      batches.push(certificationsToUpload.slice(i, i + batchSize));
    }

    const writePromises = batches.map(batch => {
      const params = {
        RequestItems: {
          [TABLE_NAME]: batch.map(item => ({
            PutRequest: {
              Item: item
            }
          }))
        }
      };
      return dynamodb.batchWrite(params).promise();
    });

    await Promise.all(writePromises);

    res.status(201).json({
      success: true,
      message: `Successfully uploaded ${certificationsToUpload.length} certifications`,
      count: certificationsToUpload.length
    });
  } catch (error) {
    console.error('Error bulk uploading certifications:', error);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to bulk upload certifications',
      error: error.message
    });
  }
};

// Get certifications by category
exports.getCertificationsByCategory = async (req, res) => {
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
      }
    };

    const result = await dynamodb.scan(params).promise();
    
    // Add provider logos
    const certificationsWithLogos = await Promise.all(
      result.Items.map(async (cert) => ({
        ...cert,
        providerLogo: await getProviderLogo(cert.provider)
      }))
    );

    res.json({
      success: true,
      certifications: certificationsWithLogos,
      count: certificationsWithLogos.length
    });
  } catch (error) {
    console.error('Error fetching certifications by category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch certifications by category',
      error: error.message
    });
  }
};

// Export multer middleware for file uploads
exports.uploadMiddleware = upload.single('file'); 