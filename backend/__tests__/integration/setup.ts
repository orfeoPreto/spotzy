import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const TABLE_NAME = 'spotzy-main-test';

const rawClient = new DynamoDBClient({
  endpoint: 'http://localhost:8000',
  region: 'eu-west-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

export const localClient = rawClient;
export const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export async function createTestTable(): Promise<void> {
  await rawClient.send(new CreateTableCommand({
    TableName: TABLE_NAME,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
      { AttributeName: 'geohash', AttributeType: 'S' },
      { AttributeName: 'listingId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'GSI2',
        KeySchema: [
          { AttributeName: 'geohash', KeyType: 'HASH' },
          { AttributeName: 'listingId', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'KEYS_ONLY' },
      },
    ],
  }));
}

export async function dropTestTable(): Promise<void> {
  try {
    await rawClient.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e;
  }
}
