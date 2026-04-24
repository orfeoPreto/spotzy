import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface SpotManagerStackProps extends cdk.StackProps {
  table: dynamodb.Table;
  eventBus: events.EventBus;
  userPool: cognito.UserPool;
}

/**
 * Session 26 — Spot Manager v2.x
 *
 * Dedicated stack for the 15 Spot Manager Lambdas (kept out of ApiStack to stay
 * under the 500 resources/stack CloudFormation limit).
 *
 * Includes its own RestApi (spotzy-spot-manager-api). Frontend routes
 * /api/v1/spot-manager/*, /api/v1/admin/rc-review/*, /api/v1/listings/pool,
 * /api/v1/listings/{id}/bays/*, and /api/v1/bookings/{id}/swap-bay here.
 */
export class SpotManagerStack extends cdk.Stack {
  public readonly restApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: SpotManagerStackProps) {
    super(scope, id, props);

    const env = process.env.ENVIRONMENT ?? 'dev';
    const isProd = env === 'prod';
    const suffix = `-${env}`;
    const isLocalDev = env === 'dev-local';
    const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN ?? (isProd ? 'spotzy.be' : 'di96dohl3v2d6.cloudfront.net');
    const appUrl = isLocalDev ? 'http://localhost:3000' : `https://${cloudfrontDomain}`;

    const { table, eventBus, userPool } = props;

    const rcDocsBucketName = `spotzy-rc-documents${suffix}`;
    const fromEmail = isProd ? 'noreply@spotzy.be' : 'quarcoo.duke@gmail.com';

    // -------------------------------------------------------------------------
    // Lambda factory
    // -------------------------------------------------------------------------
    const dirMap: Record<string, string> = {
      'rc-submission-create': 'spot-manager/rc-submission-create',
      'rc-submission-presign': 'spot-manager/rc-submission-presign',
      'rc-submission-get': 'spot-manager/rc-submission-get',
      'rc-submission-list': 'spot-manager/rc-submission-list',
      'admin-rc-review-list': 'spot-manager/admin-rc-review-list',
      'admin-rc-review-lock': 'spot-manager/admin-rc-review-lock',
      'admin-rc-review-decide': 'spot-manager/admin-rc-review-decide',
      'pool-listing-create': 'spot-manager/pool-listing-create',
      'pool-bay-update': 'spot-manager/pool-bay-update',
      'pool-bay-list': 'spot-manager/pool-bay-list',
      'booking-bay-swap': 'spot-manager/booking-bay-swap',
      'pool-opt-in': 'spot-manager/pool-opt-in',
      'spot-manager-portfolio': 'spot-manager/portfolio',
      'rc-expiry-reminder-30d': 'spot-manager/rc-expiry-reminder-30d',
      'rc-expiry-reminder-7d': 'spot-manager/rc-expiry-reminder-7d',
      'rc-expiry-suspend': 'spot-manager/rc-expiry-suspend',
      // Session 28 — Tiered Pricing + Platform Fee
      'admin-platform-fee-get': 'admin/platform-fee-get',
      'admin-platform-fee-update': 'admin/platform-fee-update',
      'booking-quote': 'bookings/quote',
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

    // -------------------------------------------------------------------------
    // Shared policies
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // RC submission Lambdas
    // -------------------------------------------------------------------------
    const rcSubmissionCreateFn = mkFn('rc-submission-create', {
      RC_DOCUMENTS_BUCKET: rcDocsBucketName,
      FROM_EMAIL: fromEmail,
    });
    rcSubmissionCreateFn.addToRolePolicy(sesPolicy);

    const rcSubmissionPresignFn = mkFn('rc-submission-presign', { RC_DOCUMENTS_BUCKET: rcDocsBucketName });
    rcSubmissionPresignFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [`arn:aws:s3:::${rcDocsBucketName}/*`],
    }));

    const rcSubmissionGetFn = mkFn('rc-submission-get', { RC_DOCUMENTS_BUCKET: rcDocsBucketName });
    rcSubmissionGetFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`arn:aws:s3:::${rcDocsBucketName}/*`],
    }));

    const rcSubmissionListFn = mkFn('rc-submission-list');

    // -------------------------------------------------------------------------
    // Admin RC review Lambdas
    // -------------------------------------------------------------------------
    const adminRcReviewListFn = mkFn('admin-rc-review-list');
    const adminRcReviewLockFn = mkFn('admin-rc-review-lock');

    const adminRcReviewDecideFn = mkFn('admin-rc-review-decide', { FROM_EMAIL: fromEmail });
    adminRcReviewDecideFn.addToRolePolicy(sesPolicy);
    adminRcReviewDecideFn.addToRolePolicy(schedulerPolicy);
    adminRcReviewDecideFn.addToRolePolicy(schedulerPassRolePolicy);

    // -------------------------------------------------------------------------
    // Pool management Lambdas
    // -------------------------------------------------------------------------
    const poolListingCreateFn = mkFn('pool-listing-create');
    const poolBayUpdateFn = mkFn('pool-bay-update');
    const poolBayListFn = mkFn('pool-bay-list');

    const bookingBaySwapFn = mkFn('booking-bay-swap', { FROM_EMAIL: fromEmail });
    bookingBaySwapFn.addToRolePolicy(sesPolicy);

    const poolOptInFn = mkFn('pool-opt-in');
    const spotManagerPortfolioFn = mkFn('spot-manager-portfolio');

    // -------------------------------------------------------------------------
    // EventBridge Scheduler-triggered Lambdas
    // -------------------------------------------------------------------------
    const rcExpiryReminder30dFn = mkFn('rc-expiry-reminder-30d', { FROM_EMAIL: fromEmail });
    rcExpiryReminder30dFn.addToRolePolicy(sesPolicy);
    rcExpiryReminder30dFn.addToRolePolicy(schedulerPolicy);

    const rcExpiryReminder7dFn = mkFn('rc-expiry-reminder-7d', { FROM_EMAIL: fromEmail });
    rcExpiryReminder7dFn.addToRolePolicy(sesPolicy);
    rcExpiryReminder7dFn.addToRolePolicy(schedulerPolicy);

    const rcExpirySuspendFn = mkFn('rc-expiry-suspend', { FROM_EMAIL: fromEmail });
    rcExpirySuspendFn.addToRolePolicy(sesPolicy);
    rcExpirySuspendFn.addToRolePolicy(schedulerPolicy);

    // Scheduler role for the 3 expiry Lambdas
    const rcSchedulerRole = new iam.Role(this, 'RCExpirySchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    rcExpiryReminder30dFn.grantInvoke(rcSchedulerRole);
    rcExpiryReminder7dFn.grantInvoke(rcSchedulerRole);
    rcExpirySuspendFn.grantInvoke(rcSchedulerRole);

    adminRcReviewDecideFn.addEnvironment('RC_SCHEDULER_ROLE_ARN', rcSchedulerRole.roleArn);
    adminRcReviewDecideFn.addEnvironment('RC_EXPIRY_30D_LAMBDA_ARN', rcExpiryReminder30dFn.functionArn);
    adminRcReviewDecideFn.addEnvironment('RC_EXPIRY_7D_LAMBDA_ARN', rcExpiryReminder7dFn.functionArn);
    adminRcReviewDecideFn.addEnvironment('RC_EXPIRY_SUSPEND_LAMBDA_ARN', rcExpirySuspendFn.functionArn);

    // -------------------------------------------------------------------------
    // REST API
    // -------------------------------------------------------------------------
    this.restApi = new apigateway.RestApi(this, 'SpotzySpotManagerApi', {
      restApiName: `spotzy-spot-manager-api${suffix}`,
      description: 'Spotzy Spot Manager REST API (Session 26)',
      defaultCorsPreflightOptions: {
        allowOrigins: isProd ? ['https://spotzy.be', 'https://www.spotzy.be'] : [appUrl, 'http://localhost:3000', 'http://localhost:3001'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key'],
        allowCredentials: true,
      },
      deployOptions: { stageName: 'prod', tracingEnabled: true },
    });

    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'SpotManagerCognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: `spotzy-spot-manager-cognito${suffix}`,
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    const authOpts: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const integ = (fn: lambda.Function) => new apigateway.LambdaIntegration(fn, { proxy: true });

    // /api/v1
    const v1 = this.restApi.root.addResource('api').addResource('v1');

    // /api/v1/spot-manager
    const spotManager = v1.addResource('spot-manager');
    const rcSubmissions = spotManager.addResource('rc-submissions');
    rcSubmissions.addMethod('POST', integ(rcSubmissionCreateFn), authOpts);
    rcSubmissions.addResource('presign').addMethod('POST', integ(rcSubmissionPresignFn), authOpts);
    rcSubmissions.addResource('mine').addMethod('GET', integ(rcSubmissionListFn), authOpts);
    rcSubmissions.addResource('{submissionId}').addMethod('GET', integ(rcSubmissionGetFn), authOpts);
    spotManager.addResource('portfolio').addMethod('GET', integ(spotManagerPortfolioFn), authOpts);

    // /api/v1/admin/rc-review
    const adminRcReview = v1.addResource('admin').addResource('rc-review');
    adminRcReview.addMethod('GET', integ(adminRcReviewListFn), authOpts);
    const adminRcReviewById = adminRcReview.addResource('{submissionId}');
    adminRcReviewById.addResource('lock').addMethod('POST', integ(adminRcReviewLockFn), authOpts);
    adminRcReviewById.addResource('decide').addMethod('POST', integ(adminRcReviewDecideFn), authOpts);

    // /api/v1/listings/pool
    const listings = v1.addResource('listings');
    listings.addResource('pool').addMethod('POST', integ(poolListingCreateFn), authOpts);
    // /api/v1/listings/{id}/...
    const listingById = listings.addResource('{id}');
    const listingBays = listingById.addResource('bays');
    listingBays.addMethod('GET', integ(poolBayListFn), authOpts);
    listingBays.addResource('{bayId}').addMethod('PATCH', integ(poolBayUpdateFn), authOpts);
    // /api/v1/listings/{id}/block-reservations — opt pool in/out of block matching
    listingById.addResource('block-reservations').addMethod('PATCH', integ(poolOptInFn), authOpts);

    // /api/v1/bookings/{id}/swap-bay
    const bookingsResource = v1.addResource('bookings');
    bookingsResource.addResource('{id}').addResource('swap-bay')
      .addMethod('POST', integ(bookingBaySwapFn), authOpts);

    // -------------------------------------------------------------------------
    // Session 28 — Tiered Pricing + Platform Fee Lambdas
    // -------------------------------------------------------------------------
    const adminPlatformFeeGetFn = mkFn('admin-platform-fee-get');
    const adminPlatformFeeUpdateFn = mkFn('admin-platform-fee-update');
    const bookingQuoteFn = mkFn('booking-quote');

    // /api/v1/admin/config/platform-fee
    const adminConfig = v1.getResource('admin')!.addResource('config');
    const adminPlatformFee = adminConfig.addResource('platform-fee');
    adminPlatformFee.addMethod('GET', integ(adminPlatformFeeGetFn), authOpts);
    adminPlatformFee.addMethod('POST', integ(adminPlatformFeeUpdateFn), authOpts);

    // /api/v1/bookings/quote
    bookingsResource.addResource('quote').addMethod('POST', integ(bookingQuoteFn), authOpts);

    // -------------------------------------------------------------------------
    // RC Documents S3 bucket (grant access)
    // -------------------------------------------------------------------------
    const rcBucket = s3.Bucket.fromBucketName(this, 'RCDocsBucketRef', rcDocsBucketName);
    rcBucket.grantWrite(rcSubmissionCreateFn);
    rcBucket.grantWrite(rcSubmissionPresignFn);
    rcBucket.grantRead(rcSubmissionGetFn);
    rcBucket.grantRead(adminRcReviewDecideFn);

    // -------------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'SpotManagerApiUrl', { value: this.restApi.url });
  }
}
