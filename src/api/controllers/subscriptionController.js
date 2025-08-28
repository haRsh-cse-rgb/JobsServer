const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
// const kafkaProducer = require('../../services/kafka');
const logActivity = require('../utils/activityLogger');

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const subscriptionController = {
  async subscribe(req, res) {
    try {
      const { email, categories } = req.body;

      if (!email || !categories || !Array.isArray(categories)) {
        return res.status(400).json({ 
          error: 'Email and categories array are required' 
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      // Store subscriptions in DynamoDB
      const subscriptions = categories.map(category => ({
        email,
        category,
        subscribedAt: new Date().toISOString()
      }));

      // Batch write subscriptions
      for (const subscription of subscriptions) {
        const params = {
          TableName: process.env.SUBSCRIPTIONS_TABLE,
          Item: subscription
        };

        const command = new PutCommand(params);
        await docClient.send(command);
      }

      // Send event to Kafka for newsletter processing
      // try {
      //   await kafkaProducer.send({
      //     topic: 'new-subscriptions',
      //     messages: [{
      //       key: email,
      //       value: JSON.stringify({
      //         email,
      //         categories,
      //         subscribedAt: new Date().toISOString()
      //       })
      //     }]
      //   });
      // } catch (kafkaError) {
      //   console.error('Kafka error (non-blocking):', kafkaError);
      //   // Continue even if Kafka fails
      // }

      res.json({
        message: 'Subscription successful',
        email,
        categories
      });
      // Log activity (if admin)
      if (req.user && req.user.email) {
        await logActivity({
          action: 'added',
          targetType: 'subscription',
          targetId: email,
          adminEmail: req.user.email,
        });
      }
    } catch (error) {
      console.error('Error processing subscription:', error);
      res.status(500).json({ error: 'Subscription failed' });
    }
  }
};

module.exports = subscriptionController;