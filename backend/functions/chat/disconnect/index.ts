import { APIGatewayProxyHandler } from 'aws-lambda';
import { createLogger } from '../../../shared/utils/logger';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('chat-disconnect', event.requestContext.connectionId ?? 'unknown');
  try {
    const connectionId = event.requestContext.connectionId;
    log.info('websocket disconnect', { connectionId });

    // TODO: implement WebSocket $disconnect handler
    // 1. Remove connectionId mapping from DynamoDB
    // 2. Return 200

    void connectionId;
    return { statusCode: 200, body: 'Disconnected' };
  } catch (err) {
    console.error('chat-disconnect error', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
