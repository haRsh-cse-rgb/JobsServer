const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

async function logActivity({ action, targetType, targetId, adminEmail }) {
  // Normalize action and targetType for consistency
  const normalizedAction = (action || '').toUpperCase();
  const normalizedTargetType = (targetType || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const timestamp = new Date().toISOString();
  const params = {
    TableName: 'AdminActivities',
    Item: {
      id: uuidv4(),
      action: normalizedAction,
      targetType: normalizedTargetType,
      targetId,
      adminEmail,
      timestamp,
    },
  };
  try {
    const command = new PutCommand(params);
    await docClient.send(command);
  } catch (err) {
    console.error('Error logging activity:', err);
  }
}

module.exports = logActivity;