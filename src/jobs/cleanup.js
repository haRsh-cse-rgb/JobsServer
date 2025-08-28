const cron = require('node-cron');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

// Run every day at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('🧹 Running job cleanup task...');
  
  try {
    const now = new Date().toISOString();
    
    // Scan for expired jobs
    const params = {
      TableName: process.env.JOBS_TABLE,
      FilterExpression: '#status = :active AND expiresOn < :now',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':active': 'active',
        ':now': now
      }
    };

    const command = new ScanCommand(params);
    const result = await docClient.send(command);

    if (result.Items && result.Items.length > 0) {
      console.log(`Found ${result.Items.length} expired jobs`);

      // Update each expired job
      for (const job of result.Items) {
        const updateParams = {
          TableName: process.env.JOBS_TABLE,
          Key: {
            category: job.category,
            jobId: job.jobId
          },
          UpdateExpression: 'SET #status = :expired',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':expired': 'expired'
          }
        };

        const updateCommand = new UpdateCommand(updateParams);
        await docClient.send(updateCommand);
      }

      console.log(`✅ Updated ${result.Items.length} jobs to expired status`);
    } else {
      console.log('No expired jobs found');
    }
  } catch (error) {
    console.error('❌ Job cleanup failed:', error);
  }
});

console.log('📅 Job cleanup cron job scheduled');