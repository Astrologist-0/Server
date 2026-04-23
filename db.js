const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const db = DynamoDBDocumentClient.from(client, {
  marshallOptions:   { removeUndefinedValues: true, convertEmptyValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

const TABLE = process.env.DYNAMODB_TABLE || 'astrologist-customers';

// Save or update a customer chart
async function saveChart(data) {
  const item = {
    customerId: data.customerId,          // partition key (uuid)
    createdAt:  data.createdAt || new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
    name:       data.name       || '',
    location:   data.location   || '',
    lat:        data.lat,
    lon:        data.lon,
    birthDate:  data.birthDate,           // ISO string
    lagnaSign:  data.lagnaSign,
    ayanamsa:   data.ayanamsa,
    planets:    data.planets    || {},
    panchanga:  data.panchanga  || {},
  };
  await db.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

// Get a single customer by ID
async function getChart(customerId) {
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: { customerId } }));
  return res.Item || null;
}

// List all customers (paginated, max 50)
async function listCharts(limit = 50, lastKey = null) {
  const params = { TableName: TABLE, Limit: limit };
  if (lastKey) params.ExclusiveStartKey = lastKey;
  const res = await db.send(new ScanCommand(params));
  return { items: res.Items || [], lastKey: res.LastEvaluatedKey || null };
}

// Delete a customer
async function deleteChart(customerId) {
  await db.send(new DeleteCommand({ TableName: TABLE, Key: { customerId } }));
}

module.exports = { saveChart, getChart, listCharts, deleteChart };
