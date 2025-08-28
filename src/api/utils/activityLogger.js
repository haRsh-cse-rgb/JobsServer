const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();

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
    await dynamoDb.put(params).promise();
  } catch (err) {
    console.error('Error logging activity:', err);
  }
}

module.exports = logActivity;