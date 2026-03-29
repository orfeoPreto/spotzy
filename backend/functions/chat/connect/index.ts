import { APIGatewayProxyHandler } from 'aws-lambda';
import { createLogger } from '../../../shared/utils/logger';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('chat-connect', event.requestContext.connectionId ?? 'unknown');
  try {
    const connectionId = event.requestContext.connectionId;
    const bookingId = event.queryStringParameters?.bookingId;
    log.info('websocket connect', { connectionId, bookingId });

    // TODO: implement WebSocket $connect handler
    // 1. Validate the caller is a participant of the booking (spotter or host)
    // 2. Store connectionId → bookingId mapping in DynamoDB (with TTL)
    // 3. Return 200 to allow the connection

    void connectionId;
    void bookingId;
    return { statusCode: 200, body: 'Connected' };
  } catch (err) {
    console.error('chat-connect error', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
