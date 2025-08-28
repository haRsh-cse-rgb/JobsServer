const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');

const s3Client = new S3Client({ region: process.env.AWS_REGION });

const s3Controller = {
  async getPreSignedUrl(req, res) {
    try {
      const { fileType = 'application/pdf' } = req.query;
      
      // Generate unique key for the file
      const ext = fileType === 'application/pdf' ? '.pdf' : '';
      const key = `cvs/${uuidv4()}-${Date.now()}${ext}`;
      
      const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        ContentType: fileType,
        Metadata: {
          uploadedAt: new Date().toISOString()
        }
      });

      // Generate pre-signed URL (expires in 5 minutes)
      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

      res.json({
        uploadUrl: signedUrl,
        key: key,
        expiresIn: 300
      });
    } catch (error) {
      console.error('Gemini API error:', error.response?.data || error.message);
      throw error;
    }
  }
};

module.exports = s3Controller;