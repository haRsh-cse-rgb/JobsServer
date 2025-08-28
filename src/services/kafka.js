// Kafka service disabled - uncomment to re-enable
/*
const { Kafka } = require('kafkajs');

let producer;

try {
  const kafka = new Kafka({
    clientId: 'jobquest-api',
    brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['kafka:9092']
  });

  producer = kafka.producer();

  producer.connect().then(() => {
    console.log('✅ Connected to Kafka');
  }).catch((error) => {
    console.error('Kafka connection failed:', error);
  });
} catch (error) {
  console.error('Kafka initialization failed:', error);
  // Create a mock producer for development
  producer = {
    send: async (message) => {
      console.log('Mock Kafka message:', message);
      return Promise.resolve();
    }
  };
}

module.exports = producer;
*/

// Mock producer for when Kafka is disabled
const mockProducer = {
  send: async (message) => {
    console.log('Kafka disabled - Mock message:', message);
    return Promise.resolve();
  }
};

module.exports = mockProducer;