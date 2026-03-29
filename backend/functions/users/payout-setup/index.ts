import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import Stripe from 'stripe';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized, internalError } from '../../../shared/utils/response';
import { userProfileKey } from '../../../shared/db/keys';
import { getStripeSecretKey } from '../../payments/shared/stripe-helpers';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const APP_URL = process.env.APP_URL ?? 'https://spotzy.com';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-payout-setup', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  const country: string = body.country ?? 'BE';

  const userResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(claims.userId) }));
  const user = userResult.Item;

  try {
    const stripeKey = await getStripeSecretKey();
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    let accountId: string = user?.stripeConnectAccountId;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country,
        email: user?.email ?? claims.email,
        capabilities: { transfers: { requested: true } },
      });
      accountId = account.id;

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: userProfileKey(claims.userId),
        UpdateExpression: 'SET stripeConnectAccountId = :aid, updatedAt = :now',
        ExpressionAttributeValues: { ':aid': accountId, ':now': new Date().toISOString() },
      }));
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${APP_URL}/become-host`,
      return_url: `${APP_URL}/become-host?payout=success`,
      type: 'account_onboarding',
    });

    log.info('payout onboarding url created', { accountId });
    return ok({ onboardingUrl: accountLink.url });
  } catch (err) {
    log.error('stripe payout setup error', err);
    return internalError();
  }
};
