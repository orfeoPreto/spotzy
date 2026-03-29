import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/messages/unread/index';
import { mockAuthContext } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

const USER_ID = 'user-123';

const makeEvent = (userId = USER_ID): APIGatewayProxyEvent =>
  ({
    ...mockAuthContext(userId),
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/messages/unread-count',
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
});

describe('messages-unread', () => {
  it('returns total unread count across all active conversations', async () => {
    // Mock: booking A has 3 unread, booking B has 1 unread
    ddbMock.on(QueryCommand).callsFake((input) => {
      const eav = input.ExpressionAttributeValues ?? {};
      // Spotter bookings
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('SPOTTER#')) {
        return {
          Items: [
            { bookingId: 'bA', status: 'CONFIRMED', spotterId: USER_ID, hostId: 'h1', listingId: 'l1' },
            { bookingId: 'bB', status: 'ACTIVE', spotterId: USER_ID, hostId: 'h2', listingId: 'l2' },
          ],
        };
      }
      // Host listings - none
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('HOST#')) {
        return { Items: [] };
      }
      // UNREAD# records
      if ((eav[':pk'] as string)?.startsWith('USER#') && (eav[':prefix'] as string) === 'UNREAD#') {
        return {
          Items: [
            { PK: `USER#${USER_ID}`, SK: 'UNREAD#bA', unreadCount: 3 },
            { PK: `USER#${USER_ID}`, SK: 'UNREAD#bB', unreadCount: 1 },
          ],
        };
      }
      return { Items: [] };
    });

    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body).unreadCount).toBe(4);
  });

  it('returns 0 when no unread messages', async () => {
    ddbMock.on(QueryCommand).callsFake((input) => {
      const eav = input.ExpressionAttributeValues ?? {};
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('SPOTTER#')) {
        return {
          Items: [
            { bookingId: 'bA', status: 'CONFIRMED', spotterId: USER_ID, hostId: 'h1', listingId: 'l1' },
          ],
        };
      }
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('HOST#')) {
        return { Items: [] };
      }
      if ((eav[':pk'] as string)?.startsWith('USER#') && (eav[':prefix'] as string) === 'UNREAD#') {
        return { Items: [] };
      }
      return { Items: [] };
    });

    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body).unreadCount).toBe(0);
  });

  it('only counts unread from PENDING/CONFIRMED/ACTIVE bookings', async () => {
    ddbMock.on(QueryCommand).callsFake((input) => {
      const eav = input.ExpressionAttributeValues ?? {};
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('SPOTTER#')) {
        return {
          Items: [
            { bookingId: 'bActive', status: 'CONFIRMED', spotterId: USER_ID, hostId: 'h1', listingId: 'l1' },
            { bookingId: 'bDone', status: 'COMPLETED', spotterId: USER_ID, hostId: 'h2', listingId: 'l2' },
          ],
        };
      }
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('HOST#')) {
        return { Items: [] };
      }
      // Return unread for both, but only active should be counted
      if ((eav[':pk'] as string)?.startsWith('USER#') && (eav[':prefix'] as string) === 'UNREAD#') {
        return {
          Items: [
            { PK: `USER#${USER_ID}`, SK: 'UNREAD#bActive', unreadCount: 3 },
            { PK: `USER#${USER_ID}`, SK: 'UNREAD#bDone', unreadCount: 5 },
          ],
        };
      }
      return { Items: [] };
    });

    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    // Only the 3 from the active booking, not the 5 from completed
    expect(JSON.parse(res!.body).unreadCount).toBe(3);
  });

  it('unauthenticated → 401', async () => {
    const event = {
      ...makeEvent(),
      requestContext: { authorizer: {} },
    } as unknown as APIGatewayProxyEvent;
    const res = await handler(event, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });
});
