import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface BlockReservationsStackProps extends cdk.StackProps {
  table: dynamodb.Table;
  eventBus: events.EventBus;
  userPool: cognito.UserPool;
}

/**
 * Session 27 — Block Spotter v2.x
 *
 * This stack hosts the 14 block reservation Lambdas in a dedicated CloudFormation
 * stack (separate from ApiStack) to stay under the 500-resource-per-stack limit.
 *
 * The stack creates its own RestApi (spotzy-block-api) with its own URL. The frontend
 * reads NEXT_PUBLIC_BLOCK_API_URL to route /api/v1/block-requests/* and /claim/* calls
 * here.
 */
export class BlockReservationsStack extends cdk.Stack {
  public readonly restApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: BlockReservationsStackProps) {
    super(scope, id, props);

    const env = process.env.ENVIRONMENT ?? 'dev';
    const isProd = env === 'prod';
    const suffix = `-${env}`;
    const isLocalDev = env === 'dev-local';
    const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN ?? (isProd ? 'spotzy.be' : 'di96dohl3v2d6.cloudfront.net');
    const appUrl = isLocalDev ? 'http://localhost:3000' : `https://${cloudfrontDomain}`;

    const { table, eventBus, userPool } = props;

    // -------------------------------------------------------------------------
    // Lambda factory
    // -------------------------------------------------------------------------
    const dirMap: Record<string, string> = {
      'block-request-create': 'block-reservations/request-create',
      'block-request-update': 'block-reservations/request-update',
      'block-request-get': 'block-reservations/request-get',
      'block-request-list': 'block-reservations/request-list',
      'block-match': 'block-reservations/match',
      'block-accept-plan': 'block-reservations/accept-plan',
      'block-authorise': 'block-reservations/authorise',
      'block-settle': 'block-reservations/settle',
      'block-request-cancel': 'block-reservations/request-cancel',
      'block-guest-add': 'block-reservations/guest-add',
      'block-guest-reassign': 'block-reservations/guest-reassign',
      'block-guest-anonymise': 'block-reservations/guest-anonymise',
      'magic-link-claim': 'block-reservations/magic-link-claim',
      'block-payment-webhook': 'block-reservations/payment-webhook',
    };

    const mkFn = (shortName: string, extraEnv?: Record<string, string>): lambda.Function => {
      const dir = dirMap[shortName];
      if (!dir) throw new Error(`No handler path for ${shortName}`);
      const fn = new lambdaNodejs.NodejsFunction(this, `${shortName.replace(/-/g, '')}Fn`, {
        functionName: `spotzy-${shortName}${suffix}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../../backend/functions', dir, 'index.ts'),
        handler: 'handler',
        tracing: lambda.Tracing.ACTIVE,
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        bundling: { minify: true, sourceMap: true, externalModules: [] },
        environment: {
          TABLE_NAME: table.tableName,
          EVENT_BUS_NAME: eventBus.eventBusName,
          ENVIRONMENT: env,
          ...extraEnv,
        },
      });
      table.grantReadWriteData(fn);
      eventBus.grantPutEventsTo(fn);
      return fn as unknown as lambda.Function;
    };

    const stripeSecretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:spotzy/stripe/secret-key*`;
    const stripeWebhookSecretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:spotzy/stripe/webhook-secret*`;
    const fromEmail = isProd ? 'noreply@spotzy.be' : 'quarcoo.duke@gmail.com';

    // Scheduler policy shared across multiple Lambdas
    const schedulerPolicy = new iam.PolicyStatement({
      actions: ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule', 'scheduler:GetSchedule', 'scheduler:UpdateSchedule'],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/*`],
    });
    const schedulerPassRolePolicy = new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: ['*'],
      conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
    });
    const sesPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    });
    const stripeSecretPolicy = new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [stripeSecretArn],
    });
    const stripeWebhookSecretPolicy = new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [stripeWebhookSecretArn],
    });

    // -------------------------------------------------------------------------
    // Lambda instantiation
    // -------------------------------------------------------------------------
    const blockRequestCreateFn = mkFn('block-request-create');
    const blockRequestUpdateFn = mkFn('block-request-update');
    const blockRequestGetFn = mkFn('block-request-get');
    const blockRequestListFn = mkFn('block-request-list');
    const blockMatchFn = mkFn('block-match');

    const blockAcceptPlanFn = mkFn('block-accept-plan', { FROM_EMAIL: fromEmail });
    blockAcceptPlanFn.addToRolePolicy(schedulerPolicy);
    blockAcceptPlanFn.addToRolePolicy(schedulerPassRolePolicy);
    blockAcceptPlanFn.addToRolePolicy(sesPolicy);
    blockAcceptPlanFn.addToRolePolicy(stripeSecretPolicy);

    const blockAuthoriseFn = mkFn('block-authorise', { FROM_EMAIL: fromEmail });
    blockAuthoriseFn.addToRolePolicy(schedulerPolicy);
    blockAuthoriseFn.addToRolePolicy(schedulerPassRolePolicy);
    blockAuthoriseFn.addToRolePolicy(sesPolicy);
    blockAuthoriseFn.addToRolePolicy(stripeSecretPolicy);

    const blockSettleFn = mkFn('block-settle', { FROM_EMAIL: fromEmail });
    blockSettleFn.addToRolePolicy(sesPolicy);
    blockSettleFn.addToRolePolicy(stripeSecretPolicy);

    const blockRequestCancelFn = mkFn('block-request-cancel', { FROM_EMAIL: fromEmail });
    blockRequestCancelFn.addToRolePolicy(schedulerPolicy);
    blockRequestCancelFn.addToRolePolicy(sesPolicy);
    blockRequestCancelFn.addToRolePolicy(stripeSecretPolicy);

    const blockGuestAddFn = mkFn('block-guest-add', { FROM_EMAIL: fromEmail });
    blockGuestAddFn.addToRolePolicy(sesPolicy);

    const blockGuestReassignFn = mkFn('block-guest-reassign', { FROM_EMAIL: fromEmail });
    blockGuestReassignFn.addToRolePolicy(sesPolicy);

    const blockGuestAnonymiseFn = mkFn('block-guest-anonymise');
    blockGuestAnonymiseFn.addToRolePolicy(schedulerPolicy);

    const magicLinkClaimFn = mkFn('magic-link-claim', {
      MAGIC_LINK_SECRET_ARN: `arn:aws:secretsmanager:${this.region}:${this.account}:secret:spotzy/block-reservations/magic-link-signing-key*`,
    });
    magicLinkClaimFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:spotzy/block-reservations/magic-link-signing-key*`],
    }));

    const blockPaymentWebhookFn = mkFn('block-payment-webhook');
    blockPaymentWebhookFn.addToRolePolicy(schedulerPolicy);
    blockPaymentWebhookFn.addToRolePolicy(schedulerPassRolePolicy);
    blockPaymentWebhookFn.addToRolePolicy(stripeWebhookSecretPolicy);

    // Scheduler role for block reservation lifecycle
    const blockSchedulerRole = new iam.Role(this, 'BlockReservationSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    blockAuthoriseFn.grantInvoke(blockSchedulerRole);
    blockSettleFn.grantInvoke(blockSchedulerRole);
    blockGuestAnonymiseFn.grantInvoke(blockSchedulerRole);

    blockAcceptPlanFn.addEnvironment('BLOCK_SCHEDULER_ROLE_ARN', blockSchedulerRole.roleArn);
    blockAcceptPlanFn.addEnvironment('BLOCK_AUTHORISE_LAMBDA_ARN', blockAuthoriseFn.functionArn);
    blockAcceptPlanFn.addEnvironment('BLOCK_SETTLE_LAMBDA_ARN', blockSettleFn.functionArn);
    blockAcceptPlanFn.addEnvironment('BLOCK_ANONYMISE_LAMBDA_ARN', blockGuestAnonymiseFn.functionArn);

    // -------------------------------------------------------------------------
    // REST API (separate from SpotzyApiStack)
    // -------------------------------------------------------------------------
    this.restApi = new apigateway.RestApi(this, 'SpotzyBlockApi', {
      restApiName: `spotzy-block-api${suffix}`,
      description: 'Spotzy Block Reservations REST API (Session 27)',
      defaultCorsPreflightOptions: {
        allowOrigins: isProd ? ['https://spotzy.be', 'https://www.spotzy.be'] : [appUrl, 'http://localhost:3000'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key'],
        allowCredentials: true,
      },
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
      },
    });

    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'BlockCognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: `spotzy-block-cognito${suffix}`,
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    const authOpts: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };
    const publicOpts: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.NONE,
    };
    const stripeWebhookOpts: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestParameters: { 'method.request.header.stripe-signature': true },
    };

    const integ = (fn: lambda.Function) => new apigateway.LambdaIntegration(fn, { proxy: true });

    // /api/v1
    const v1 = this.restApi.root.addResource('api').addResource('v1');

    // /api/v1/block-requests
    const blockRequests = v1.addResource('block-requests');
    blockRequests.addMethod('GET', integ(blockRequestListFn), authOpts);
    blockRequests.addMethod('POST', integ(blockRequestCreateFn), authOpts);
    const blockRequestById = blockRequests.addResource('{reqId}');
    blockRequestById.addMethod('GET', integ(blockRequestGetFn), authOpts);
    blockRequestById.addMethod('PATCH', integ(blockRequestUpdateFn), authOpts);
    blockRequestById.addMethod('DELETE', integ(blockRequestCancelFn), authOpts);
    blockRequestById.addResource('accept').addMethod('POST', integ(blockAcceptPlanFn), authOpts);
    const blockGuests = blockRequestById.addResource('guests');
    blockGuests.addMethod('POST', integ(blockGuestAddFn), authOpts);
    blockGuests.addResource('{bookingId}').addMethod('PATCH', integ(blockGuestReassignFn), authOpts);

    // /api/v1/public/claim/{token} — magic link, no auth
    const publicResource = v1.addResource('public');
    publicResource.addResource('claim').addResource('{token}').addMethod('GET', integ(magicLinkClaimFn), publicOpts);

    // /api/v1/payments/block-webhook — Stripe webhook
    v1.addResource('payments').addResource('block-webhook').addMethod('POST', integ(blockPaymentWebhookFn), stripeWebhookOpts);

    // -------------------------------------------------------------------------
    // EventBridge rule — dispatches block.request.created / updated to block-match
    // -------------------------------------------------------------------------
    new events.Rule(this, 'BlockMatchRule', {
      ruleName: `spotzy-block-match${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy.block-reservations'],
        detailType: ['block.request.created', 'block.request.updated'],
      },
      targets: [new (require('aws-cdk-lib/aws-events-targets').LambdaFunction)(blockMatchFn)],
    });

    // -------------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'BlockApiUrl', { value: this.restApi.url });
  }
}
