import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  table: dynamodb.Table;
  eventBus: events.EventBus;
  mediaUploadsBucket: s3.Bucket;
}

// Lambda function names exported so IntegrationStack can reference them by name.
export const LAMBDA_NAMES = {
  listingCreate: 'listing-create',
  listingSearch: 'listing-search',
  listingGet: 'listing-get',
  listingUpdate: 'listing-update',
  listingPublish: 'listing-publish',
  listingDelete: 'listing-delete',
  listingPhotoUrl: 'listing-photo-url',
  listingPhotoDelete: 'listing-photo-delete',
  listingPhotoReorder: 'listing-photo-reorder',
  listingAiValidate: 'listing-ai-validate',
  listingAvailabilityGet: 'listing-availability-get',
  listingAvailabilityPut: 'listing-availability-put',
  bookingCreate: 'booking-create',
  bookingGet: 'booking-get',
  bookingModify: 'booking-modify',
  bookingCancel: 'booking-cancel',
  paymentIntent: 'payment-intent',
  paymentWebhook: 'payment-webhook',
  payoutTrigger: 'payout-trigger',
  chatGet: 'chat-get',
  chatSend: 'chat-send',
  chatConnect: 'chat-connect',
  chatDisconnect: 'chat-disconnect',
  chatWsSend: 'chat-ws-send',
  chatImageUrl: 'chat-image-url',
  reviewCreate: 'review-create',
  reviewAggregate: 'review-aggregate',
  disputeCreate: 'dispute-create',
  disputeMessage: 'dispute-message',
  disputeEscalate: 'dispute-escalate',
  userGet: 'user-get',
  userUpdate: 'user-update',
  userPublicGet: 'user-public-get',
  userMeListings: 'user-me-listings',
  userMeBookings: 'user-me-bookings',
  userMeMetrics: 'user-me-metrics',
  userPhotoUrl: 'user-photo-url',
  payoutSetup: 'payout-setup',
  userBecomeHost: 'user-become-host',
  availabilityBlock: 'availability-block',
  availabilityRelease: 'availability-release',
  notifySms: 'notify-sms',
  notifyEmail: 'notify-email',
  preferenceLearn: 'preference-learn',
  messagesList: 'messages-list',
  messagesUnread: 'messages-unread',
  bookingStatusTransition: 'booking-status-transition',
  bookingStatusCleanup: 'booking-status-cleanup',
  userInvoicing: 'user-invoicing',
  disputeGet: 'dispute-get',
  adminDisputesList: 'admin-disputes-list',
  adminDisputeGet: 'admin-dispute-get',
  adminDisputeMessage: 'admin-dispute-message',
  adminDisputeResolve: 'admin-dispute-resolve',
  adminCustomersList: 'admin-customers-list',
  adminCustomerGet: 'admin-customer-get',
  adminCustomerSuspend: 'admin-customer-suspend',
  gdprDelete: 'gdpr-delete',
  gdprExport: 'gdpr-export',
  // Session 27 — Block Spotter
  blockRequestCreate: 'block-request-create',
  blockRequestUpdate: 'block-request-update',
  blockRequestGet: 'block-request-get',
  blockRequestList: 'block-request-list',
  blockMatch: 'block-match',
  blockAcceptPlan: 'block-accept-plan',
  blockAuthorise: 'block-authorise',
  blockSettle: 'block-settle',
  blockRequestCancel: 'block-request-cancel',
  blockGuestAdd: 'block-guest-add',
  blockGuestReassign: 'block-guest-reassign',
  blockGuestAnonymise: 'block-guest-anonymise',
  magicLinkClaim: 'magic-link-claim',
  blockPaymentWebhook: 'block-payment-webhook',
  // Session 28 — Tiered Pricing + Platform Fee
  adminPlatformFeeGet: 'admin-platform-fee-get',
  adminPlatformFeeUpdate: 'admin-platform-fee-update',
  bookingQuote: 'booking-quote',
  // Session 26 — Spot Manager
  rcSubmissionCreate: 'rc-submission-create',
  rcSubmissionPresign: 'rc-submission-presign',
  rcSubmissionGet: 'rc-submission-get',
  rcSubmissionList: 'rc-submission-list',
  adminRcReviewList: 'admin-rc-review-list',
  adminRcReviewLock: 'admin-rc-review-lock',
  adminRcReviewDecide: 'admin-rc-review-decide',
  poolListingCreate: 'pool-listing-create',
  poolBayUpdate: 'pool-bay-update',
  poolBayList: 'pool-bay-list',
  bookingBaySwap: 'booking-bay-swap',
  spotManagerPortfolio: 'spot-manager-portfolio',
  rcExpiryReminder30d: 'rc-expiry-reminder-30d',
  rcExpiryReminder7d: 'rc-expiry-reminder-7d',
  rcExpirySuspend: 'rc-expiry-suspend',
  // Session 29 — Localization
  listingTranslate: 'listing-translate',
  translateOnDemand: 'translate-on-demand',
} as const;

export class ApiStack extends cdk.Stack {
  public readonly restApi: apigateway.RestApi;
  public readonly webSocketApi: apigatewayv2.CfnApi;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  /** Map of short name → deployed Lambda, for use by IntegrationStack or tests. */
  public readonly functions: Record<string, lambda.Function> = {};

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const env = process.env.ENVIRONMENT ?? 'dev';
    const isProd = env === 'prod';
    const suffix = isProd ? '' : `-${env}`;
    // CloudFront domain — pass via CLOUDFRONT_DOMAIN env var for new environments, default to existing dev domain
    const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN ?? (isProd ? 'spotzy.com' : 'di96dohl3v2d6.cloudfront.net');
    const isLocalDev = env === 'dev-local';
    const appUrl = isLocalDev ? 'http://localhost:3000' : `https://${cloudfrontDomain}`;

    const { table, eventBus, mediaUploadsBucket } = props;
    // Import media-public bucket by name (owned by FrontendStack to avoid OAC cross-stack cycle)
    const mediaPublicBucket = s3.Bucket.fromBucketName(
      this,
      'MediaPublicBucketRef',
      `spotzy-media-public${suffix}`,
    );
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // -----------------------------------------------------------------------
    // Cognito User Pool
    // -----------------------------------------------------------------------
    this.userPool = new cognito.UserPool(this, 'SpotzyUserPool', {
      userPoolName: `spotzy-users${suffix}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        phoneNumber: { required: true, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy,
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'SpotzyUserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `spotzy-web-client${suffix}`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: false,
      },
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
      },
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, givenName: true, familyName: true, phoneNumber: true })
        .withCustomAttributes('role'),
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, givenName: true, familyName: true, phoneNumber: true, emailVerified: true })
        .withCustomAttributes('role'),
    });

    // -----------------------------------------------------------------------
    // Lambda factory — bundles TypeScript handlers from backend/functions/
    // Short name maps to the directory path under backend/functions/
    // e.g. 'listing-create' → backend/functions/listings/create/index.ts
    // -----------------------------------------------------------------------
    const handlerPath = (shortName: string): string => {
      const segments = shortName.split('-');
      // Map short name to directory: 'listing-create' → 'listings/create'
      // 'booking-create' → 'bookings/create', 'payment-intent' → 'payments/intent'
      // 'availability-block' → 'availability/block', 'notify-sms' → 'notifications/sms'
      // 'chat-send' → 'chat/send', 'review-create' → 'reviews/create'
      // 'dispute-create' → 'disputes/create', 'user-get' → 'users/get'
      // 'payout-setup' → 'users/payout-setup', 'payout-trigger' → 'payments/payout-trigger'
      // 'preference-learn' → 'preferences/learn', 'review-aggregate' → 'reviews/aggregate'
      const dirMap: Record<string, string> = {
        'auth-register': 'auth/register',
        'auth-login': 'auth/login',
        'auth-verify-otp': 'auth/verify-otp',
        'auth-resend-otp': 'auth/resend-otp',
        'auth-forgot-password': 'auth/forgot-password',
        'listing-create': 'listings/create',
        'listing-search': 'listings/search',
        'listing-get': 'listings/get',
        'listing-update': 'listings/update',
        'listing-publish': 'listings/publish',
        'listing-delete': 'listings/delete',
        'listing-photo-url': 'listings/photo-url',
        'listing-photo-delete': 'listings/photo-delete',
        'listing-photo-reorder': 'listings/photo-reorder',
        'listing-ai-validate': 'listings/ai-validate',
        'listing-availability-get': 'listings/availability-get',
        'listing-availability-put': 'listings/availability-put',
        'booking-create': 'bookings/create',
        'booking-get': 'bookings/get',
        'booking-modify': 'bookings/modify',
        'booking-cancel': 'bookings/cancel',
        'payment-intent': 'payments/intent',
        'payment-webhook': 'payments/webhook',
        'payout-trigger': 'payments/payout-trigger',
        'chat-get': 'chat/get',
        'chat-send': 'chat/send',
        'chat-connect': 'chat/connect',
        'chat-disconnect': 'chat/disconnect',
        'chat-ws-send': 'chat/send',  // reuse send handler for WS
        'chat-image-url': 'chat/image-url',
        'review-create': 'reviews/create',
        'review-aggregate': 'reviews/aggregate',
        'dispute-create': 'disputes/create',
        'dispute-get': 'disputes/get',
        'dispute-message': 'disputes/message',
        'dispute-escalate': 'disputes/escalate',
        'user-get': 'users/get',
        'user-update': 'users/update',
        'user-public-get': 'users/public-get',
        'user-me-listings': 'users/me-listings',
        'user-me-bookings': 'users/me-bookings',
        'user-me-metrics': 'users/me-metrics',
        'user-photo-url': 'users/photo-url',
        'payout-setup': 'users/payout-setup',
        'user-become-host': 'users/become-host',
        'messages-list': 'messages/list',
        'messages-unread': 'messages/unread',
        'booking-status-transition': 'bookings/status-transition',
        'booking-status-cleanup': 'bookings/status-cleanup',
        'user-invoicing': 'users/invoicing',
        'availability-block': 'availability/block',
        'availability-release': 'availability/release',
        'notify-sms': 'notifications/sms',
        'notify-email': 'notifications/email',
        'preference-learn': 'preferences/learn',
        'user-post-confirmation': 'users/post-confirmation',
        'admin-disputes-list': 'admin/disputes-list',
        'admin-dispute-get': 'admin/dispute-get',
        'admin-dispute-message': 'admin/dispute-message',
        'admin-dispute-resolve': 'admin/dispute-resolve',
        'admin-customers-list': 'admin/customers-list',
        'admin-customer-get': 'admin/customer-get',
        'admin-customer-suspend': 'admin/customer-suspend',
        'gdpr-delete': 'gdpr/delete',
        'gdpr-export': 'gdpr/export',
        // Session 27 — Block Spotter
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
        // Session 28 — Tiered Pricing + Platform Fee
        'admin-platform-fee-get': 'admin/platform-fee-get',
        'admin-platform-fee-update': 'admin/platform-fee-update',
        'booking-quote': 'bookings/quote',
        // Session 26 — Spot Manager
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
        'spot-manager-portfolio': 'spot-manager/portfolio',
        'rc-expiry-reminder-30d': 'spot-manager/rc-expiry-reminder-30d',
        'rc-expiry-reminder-7d': 'spot-manager/rc-expiry-reminder-7d',
        'rc-expiry-suspend': 'spot-manager/rc-expiry-suspend',
        // Session 29 — Localization
        'listing-translate': 'listings/listing-translate',
        'translate-on-demand': 'translate/translate-on-demand',
      };
      const dir = dirMap[shortName];
      if (!dir) throw new Error(`No handler path for Lambda: ${shortName}`);
      return path.join(__dirname, '../../backend/functions', dir, 'index.ts');
    };

    const mkFn = (shortName: string, extraEnv?: Record<string, string>): lambda.Function => {
      const functionName = `spotzy-${shortName}${suffix}`;
      const fn = new lambdaNodejs.NodejsFunction(this, `${shortName.replace(/-/g, '')}Function`, {
        functionName,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: handlerPath(shortName),
        handler: 'handler',
        tracing: lambda.Tracing.ACTIVE,
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: [],  // bundle all deps
        },
        environment: {
          TABLE_NAME: table.tableName,
          EVENT_BUS_NAME: eventBus.eventBusName,
          ENVIRONMENT: env,
          ...extraEnv,
        },
      });
      table.grantReadWriteData(fn);
      eventBus.grantPutEventsTo(fn);
      this.functions[shortName] = fn as unknown as lambda.Function;
      return fn as unknown as lambda.Function;
    };

    // -----------------------------------------------------------------------
    // Lambda functions
    // -----------------------------------------------------------------------
    // Auth Lambdas need Cognito client ID but no table/event access for most ops
    const cognitoEnv = {
      COGNITO_CLIENT_ID: this.userPoolClient.userPoolClientId,
      COGNITO_USER_POOL_ID: this.userPool.userPoolId,
    };
    const authRegisterFn      = mkFn('auth-register',       { ...cognitoEnv, CURRENT_POLICY_VERSION: '2026-04-01' });
    const authLoginFn         = mkFn('auth-login',          cognitoEnv);
    const authVerifyOtpFn     = mkFn('auth-verify-otp',     cognitoEnv);
    const authResendOtpFn     = mkFn('auth-resend-otp',     cognitoEnv);
    const authForgotPasswordFn = mkFn('auth-forgot-password', cognitoEnv);

    // Grant Cognito API permissions to auth Lambdas
    for (const fn of [authRegisterFn, authLoginFn, authVerifyOtpFn, authResendOtpFn, authForgotPasswordFn]) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'cognito-idp:SignUp',
          'cognito-idp:InitiateAuth',
          'cognito-idp:ConfirmSignUp',
          'cognito-idp:ResendConfirmationCode',
          'cognito-idp:ForgotPassword',
        ],
        resources: [this.userPool.userPoolArn],
      }));
    }

    const listingCreateFn   = mkFn(LAMBDA_NAMES.listingCreate, {
      UPLOADS_BUCKET: mediaUploadsBucket.bucketName,
      PUBLIC_BUCKET: mediaPublicBucket.bucketName,
    });
    const listingSearchFn   = mkFn(LAMBDA_NAMES.listingSearch);
    const listingGetFn      = mkFn(LAMBDA_NAMES.listingGet);
    const listingUpdateFn   = mkFn(LAMBDA_NAMES.listingUpdate);
    const listingPublishFn  = mkFn(LAMBDA_NAMES.listingPublish);
    const listingDeleteFn   = mkFn(LAMBDA_NAMES.listingDelete);
    const listingPhotoUrlFn = mkFn(LAMBDA_NAMES.listingPhotoUrl, {
      UPLOADS_BUCKET: mediaUploadsBucket.bucketName,
    });
    const listingPhotoDeleteFn  = mkFn(LAMBDA_NAMES.listingPhotoDelete, {
      PUBLIC_BUCKET: mediaPublicBucket.bucketName,
    });
    const listingPhotoReorderFn = mkFn(LAMBDA_NAMES.listingPhotoReorder);
    const listingAvailabilityGetFn = mkFn(LAMBDA_NAMES.listingAvailabilityGet);
    const listingAvailabilityPutFn = mkFn(LAMBDA_NAMES.listingAvailabilityPut);

    const listingAiValidateFn = mkFn(LAMBDA_NAMES.listingAiValidate, {
      UPLOADS_BUCKET: mediaUploadsBucket.bucketName,
      PUBLIC_BUCKET: mediaPublicBucket.bucketName,
    });

    const bookingCreateFn  = mkFn(LAMBDA_NAMES.bookingCreate);
    const bookingGetFn     = mkFn(LAMBDA_NAMES.bookingGet);
    const bookingModifyFn  = mkFn(LAMBDA_NAMES.bookingModify);
    const bookingCancelFn  = mkFn(LAMBDA_NAMES.bookingCancel);

    const paymentIntentFn  = mkFn(LAMBDA_NAMES.paymentIntent);
    const paymentWebhookFn = mkFn(LAMBDA_NAMES.paymentWebhook);
    mkFn(LAMBDA_NAMES.payoutTrigger);

    const chatGetFn        = mkFn(LAMBDA_NAMES.chatGet);
    const chatSendFn       = mkFn(LAMBDA_NAMES.chatSend);
    const chatConnectFn    = mkFn(LAMBDA_NAMES.chatConnect);
    const chatDisconnectFn = mkFn(LAMBDA_NAMES.chatDisconnect);
    const chatWsSendFn     = mkFn(LAMBDA_NAMES.chatWsSend);
    const chatImageUrlFn   = mkFn(LAMBDA_NAMES.chatImageUrl, {
      UPLOADS_BUCKET: mediaUploadsBucket.bucketName,
      PUBLIC_BUCKET: mediaPublicBucket.bucketName,
    });

    const reviewCreateFn   = mkFn(LAMBDA_NAMES.reviewCreate);
    mkFn(LAMBDA_NAMES.reviewAggregate);

    const disputeCreateFn  = mkFn(LAMBDA_NAMES.disputeCreate);
    const disputeGetFn     = mkFn(LAMBDA_NAMES.disputeGet);
    const disputeMessageFn = mkFn(LAMBDA_NAMES.disputeMessage);
    mkFn(LAMBDA_NAMES.disputeEscalate);

    const disputeEscalateFn = this.functions[LAMBDA_NAMES.disputeEscalate];

    // Admin Lambda functions
    const adminDisputesListFn   = mkFn(LAMBDA_NAMES.adminDisputesList);
    const adminDisputeGetFn     = mkFn(LAMBDA_NAMES.adminDisputeGet);
    const adminDisputeMessageFn = mkFn(LAMBDA_NAMES.adminDisputeMessage);
    const adminDisputeResolveFn = mkFn(LAMBDA_NAMES.adminDisputeResolve);
    const adminCustomersListFn  = mkFn(LAMBDA_NAMES.adminCustomersList);
    const adminCustomerGetFn    = mkFn(LAMBDA_NAMES.adminCustomerGet);
    const adminCustomerSuspendFn = mkFn(LAMBDA_NAMES.adminCustomerSuspend, cognitoEnv);

    // Grant Cognito admin permissions to customer-suspend Lambda
    adminCustomerSuspendFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminDisableUser'],
      resources: [this.userPool.userPoolArn],
    }));

    // Grant Bedrock access for AI dispute responses
    const bedrockPolicy = new cdk.aws_iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.*',
        'arn:aws:bedrock:*:*:inference-profile/*anthropic.*',
      ],
    });
    const marketplacePolicy = new cdk.aws_iam.PolicyStatement({
      actions: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe'],
      resources: ['*'],
    });
    disputeCreateFn.addToRolePolicy(bedrockPolicy);
    disputeCreateFn.addToRolePolicy(marketplacePolicy);
    disputeMessageFn.addToRolePolicy(bedrockPolicy);
    disputeMessageFn.addToRolePolicy(marketplacePolicy);
    disputeEscalateFn.addToRolePolicy(bedrockPolicy);
    disputeEscalateFn.addToRolePolicy(marketplacePolicy);

    // GDPR Lambdas
    const gdprDeleteFn = mkFn(LAMBDA_NAMES.gdprDelete, {
      ...cognitoEnv,
      MEDIA_PUBLIC_BUCKET: mediaPublicBucket.bucketName,
      FROM_EMAIL: 'noreply@spotzy.com',
      CURRENT_POLICY_VERSION: '2026-04-01',
    });
    gdprDeleteFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminDisableUser', 'cognito-idp:AdminDeleteUser'],
      resources: [this.userPool.userPoolArn],
    }));
    gdprDeleteFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:DeleteObject'],
      resources: [`${mediaPublicBucket.bucketArn}/*`],
    }));
    gdprDeleteFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));

    const gdprExportsBucketName = `spotzy-gdpr-exports${suffix}`;
    const gdprExportFn = mkFn(LAMBDA_NAMES.gdprExport, {
      GDPR_EXPORTS_BUCKET: gdprExportsBucketName,
    });
    gdprExportFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`arn:aws:s3:::${gdprExportsBucketName}/*`],
    }));

    const userGetFn        = mkFn(LAMBDA_NAMES.userGet);
    const userUpdateFn     = mkFn(LAMBDA_NAMES.userUpdate);
    const userPublicGetFn  = mkFn(LAMBDA_NAMES.userPublicGet);
    const userMeListingsFn = mkFn(LAMBDA_NAMES.userMeListings);
    const userMeBookingsFn = mkFn(LAMBDA_NAMES.userMeBookings);
    const userMeMetricsFn  = mkFn(LAMBDA_NAMES.userMeMetrics);
    const userPhotoUrlFn   = mkFn(LAMBDA_NAMES.userPhotoUrl, {
      UPLOADS_BUCKET: mediaPublicBucket.bucketName,
      MEDIA_URL: appUrl,
    });
    const payoutSetupFn    = mkFn(LAMBDA_NAMES.payoutSetup, {
      APP_URL: appUrl,
    });
    const userBecomeHostFn = mkFn(LAMBDA_NAMES.userBecomeHost);

    const userInvoicingFn  = mkFn(LAMBDA_NAMES.userInvoicing);
    const messagesListFn   = mkFn(LAMBDA_NAMES.messagesList);
    const messagesUnreadFn = mkFn(LAMBDA_NAMES.messagesUnread);

    const bookingStatusTransitionFn = mkFn(LAMBDA_NAMES.bookingStatusTransition, {
      EVENT_BUS_NAME: eventBus.eventBusName,
    });

    // Hourly cleanup Lambda to catch missed status transitions
    const bookingStatusCleanupFn = mkFn(LAMBDA_NAMES.bookingStatusCleanup);
    new events.Rule(this, 'BookingStatusCleanupSchedule', {
      ruleName: `spotzy-booking-cleanup${suffix}`,
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new (require('aws-cdk-lib/aws-events-targets').LambdaFunction)(bookingStatusCleanupFn)],
    });

    // Grant booking-create and booking-cancel Lambdas permission to create/delete Scheduler schedules
    const schedulerPolicy = new iam.PolicyStatement({
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
      ],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/*`],
    });
    const schedulerPassRolePolicy = new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: ['*'],
      conditions: {
        StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' },
      },
    });
    bookingCreateFn.addToRolePolicy(schedulerPolicy);
    bookingCreateFn.addToRolePolicy(schedulerPassRolePolicy);
    bookingCancelFn.addToRolePolicy(schedulerPolicy);
    bookingCancelFn.addToRolePolicy(schedulerPassRolePolicy);
    paymentWebhookFn.addToRolePolicy(schedulerPolicy);
    paymentWebhookFn.addToRolePolicy(schedulerPassRolePolicy);

    // Scheduler needs a role to invoke the status-transition Lambda
    const schedulerRole = new iam.Role(this, 'BookingSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    bookingStatusTransitionFn.grantInvoke(schedulerRole);

    // Pass scheduler role ARN and target Lambda ARN to booking-create/cancel
    bookingCreateFn.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
    bookingCreateFn.addEnvironment('STATUS_TRANSITION_LAMBDA_ARN', bookingStatusTransitionFn.functionArn);
    bookingCancelFn.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
    bookingCancelFn.addEnvironment('STATUS_TRANSITION_LAMBDA_ARN', bookingStatusTransitionFn.functionArn);
    paymentWebhookFn.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
    paymentWebhookFn.addEnvironment('STATUS_TRANSITION_LAMBDA_ARN', bookingStatusTransitionFn.functionArn);

    // Stripe secret ARNs — declared early so Session 26/27/28 Lambdas can reference them
    const stripeSecretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:spotzy/stripe/secret-key*`;
    const stripeWebhookSecretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:spotzy/stripe/webhook-secret*`;

    // Session 26 Spot Manager Lambdas are in SpotManagerStack (separate
    // CloudFormation stack to stay under the 500 resources/stack limit).

    // Session 28 Tiered Pricing + Platform Fee Lambdas are in SpotManagerStack.
    // Session 27 Block Reservation Lambdas are in a separate stack
    // (infrastructure/lib/block-reservations-stack.ts) to stay under the 500
    // resource-per-stack CloudFormation limit.

    mkFn(LAMBDA_NAMES.availabilityBlock);
    mkFn(LAMBDA_NAMES.availabilityRelease);

    const notifySmsFn = mkFn(LAMBDA_NAMES.notifySms);
    notifySmsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'],
      resources: ['*'],
    }));

    const notifyEmailFn = mkFn(LAMBDA_NAMES.notifyEmail, {
      APP_URL: appUrl,
      SES_FROM_EMAIL: isProd ? 'noreply@spotzy.com' : 'quarcoo.duke@gmail.com',
    });
    notifyEmailFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    mkFn(LAMBDA_NAMES.preferenceLearn);

    // Post-confirmation trigger — creates DynamoDB user profile with phone
    const postConfirmationFn = mkFn('user-post-confirmation');
    this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFn);

    // Grant media bucket permissions
    mediaUploadsBucket.grantReadWrite(listingCreateFn);
    mediaUploadsBucket.grantPut(listingPhotoUrlFn);
    mediaPublicBucket.grantWrite(listingCreateFn);
    mediaPublicBucket.grantReadWrite(listingPhotoDeleteFn);
    mediaUploadsBucket.grantReadWrite(chatImageUrlFn);
    mediaPublicBucket.grantPut(userPhotoUrlFn);
    mediaPublicBucket.grantWrite(chatImageUrlFn);

    // ai-validate: read uploads, write public, call Rekognition
    mediaUploadsBucket.grantRead(listingAiValidateFn);
    mediaPublicBucket.grantPut(listingAiValidateFn);
    listingAiValidateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rekognition:DetectLabels', 'rekognition:DetectModerationLabels'],
      resources: ['*'],
    }));

    // payment-intent and payment-webhook need to read the Stripe secret key
    // (stripeSecretArn and stripeWebhookSecretArn declared earlier for Session 26/27)
    for (const fn of [paymentIntentFn, paymentWebhookFn, payoutSetupFn]) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [stripeSecretArn],
      }));
    }
    paymentWebhookFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [stripeWebhookSecretArn],
    }));

    // Grant Stripe secret access to admin-dispute-resolve
    adminDisputeResolveFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [stripeSecretArn],
    }));

    // -----------------------------------------------------------------------
    // Session 29 — Localization Lambdas
    // -----------------------------------------------------------------------
    const listingTranslateFn = mkFn('listing-translate');
    listingTranslateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['translate:TranslateText'],
      resources: ['*'],
    }));

    const translateOnDemandFn = mkFn('translate-on-demand');
    translateOnDemandFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['translate:TranslateText'],
      resources: ['*'],
    }));

    // EventBridge rule: listing.translation_required → listing-translate Lambda
    const listingTranslationRule = new events.Rule(this, 'ListingTranslationRule', {
      eventBus,
      eventPattern: {
        source: ['spotzy.listings'],
        detailType: ['listing.translation_required'],
      },
    });
    listingTranslationRule.addTarget(new eventsTargets.LambdaFunction(listingTranslateFn));

    // -----------------------------------------------------------------------
    // API Gateway access log group
    // -----------------------------------------------------------------------
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/spotzy-api${suffix}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy,
    });

    // -----------------------------------------------------------------------
    // REST API
    // -----------------------------------------------------------------------
    this.restApi = new apigateway.RestApi(this, 'SpotzyRestApi', {
      restApiName: `spotzy-api${suffix}`,
      description: 'Spotzy REST API',
      defaultCorsPreflightOptions: {
        allowOrigins: isProd ? ['https://spotzy.com', 'https://www.spotzy.com'] : [appUrl, 'http://localhost:3000'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key'],
        allowCredentials: true,
      },
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        throttlingBurstLimit: 1000,
        throttlingRateLimit: 500,
        metricsEnabled: true,
      },
      binaryMediaTypes: ['multipart/form-data', 'application/octet-stream'],
    });

    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'SpotzyCognitoAuthorizer',
      {
        cognitoUserPools: [this.userPool],
        authorizerName: 'spotzy-cognito-authorizer',
        identitySource: 'method.request.header.Authorization',
        resultsCacheTtl: cdk.Duration.minutes(5),
      },
    );

    const authOpts: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const publicOpts: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.NONE,
    };

    // Stripe webhook needs raw body — disable content-type conversion
    const stripeWebhookOpts: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestParameters: { 'method.request.header.stripe-signature': true },
    };

    const integ = (fn: lambda.Function) => new apigateway.LambdaIntegration(fn, {
      proxy: true,
    });

    // /api/v1
    const v1 = this.restApi.root.addResource('api').addResource('v1');

    // /api/v1/auth
    const auth = v1.addResource('auth');
    auth.addResource('register').addMethod('POST', integ(authRegisterFn), publicOpts);
    auth.addResource('login').addMethod('POST', integ(authLoginFn), publicOpts);
    auth.addResource('verify-otp').addMethod('POST', integ(authVerifyOtpFn), publicOpts);
    auth.addResource('resend-otp').addMethod('POST', integ(authResendOtpFn), publicOpts);
    auth.addResource('forgot-password').addMethod('POST', integ(authForgotPasswordFn), publicOpts);

    // /api/v1/listings
    const listings = v1.addResource('listings');
    listings.addMethod('POST', integ(listingCreateFn), authOpts);

    const listingsSearch = listings.addResource('search');
    listingsSearch.addMethod('GET', integ(listingSearchFn), publicOpts);

    const listingById = listings.addResource('{id}');
    listingById.addMethod('GET', integ(listingGetFn), publicOpts);
    listingById.addMethod('PUT', integ(listingUpdateFn), authOpts);
    listingById.addMethod('DELETE', integ(listingDeleteFn), authOpts);

    listingById.addResource('publish').addMethod('POST', integ(listingPublishFn), authOpts);
    listingById.addResource('photo-url').addMethod('POST', integ(listingPhotoUrlFn), authOpts);

    const listingPhotos = listingById.addResource('photos');
    listingPhotos.addResource('{index}').addMethod('DELETE', integ(listingPhotoDeleteFn), authOpts);
    listingPhotos.addResource('order').addMethod('PUT', integ(listingPhotoReorderFn), authOpts);

    const listingAvailability = listingById.addResource('availability');
    listingAvailability.addMethod('GET', integ(listingAvailabilityGetFn), publicOpts);
    listingAvailability.addMethod('PUT', integ(listingAvailabilityPutFn), authOpts);

    // /api/v1/bookings
    const bookings = v1.addResource('bookings');
    bookings.addMethod('POST', integ(bookingCreateFn), authOpts);
    const bookingById = bookings.addResource('{id}');
    bookingById.addMethod('GET', integ(bookingGetFn), authOpts);
    bookingById.addResource('modify').addMethod('PUT', integ(bookingModifyFn), authOpts);
    bookingById.addResource('cancel').addMethod('POST', integ(bookingCancelFn), authOpts);

    // /api/v1/payments
    const payments = v1.addResource('payments');
    payments.addResource('intent').addMethod('POST', integ(paymentIntentFn), authOpts);
    // Stripe webhook — no Cognito auth; Stripe signature verified in Lambda
    payments.addResource('webhook').addMethod('POST', integ(paymentWebhookFn), stripeWebhookOpts);

    // /api/v1/chat
    const chatByBookingId = v1.addResource('chat').addResource('{bookingId}');
    chatByBookingId.addMethod('GET', integ(chatGetFn), authOpts);
    chatByBookingId.addMethod('POST', integ(chatSendFn), authOpts);
    chatByBookingId.addResource('image-url').addMethod('POST', integ(chatImageUrlFn), authOpts);

    // /api/v1/reviews
    v1.addResource('reviews').addMethod('POST', integ(reviewCreateFn), authOpts);

    // /api/v1/disputes
    const disputes = v1.addResource('disputes');
    disputes.addMethod('GET', integ(disputeGetFn), authOpts);
    disputes.addMethod('POST', integ(disputeCreateFn), authOpts);
    disputes.addResource('{id}').addResource('message').addMethod('POST', integ(disputeMessageFn), authOpts);

    // /api/v1/users
    const usersResource = v1.addResource('users');
    usersResource.addResource('{id}').addResource('public').addMethod('GET', integ(userPublicGetFn), authOpts);
    const usersMe = usersResource.addResource('me');
    usersMe.addMethod('GET', integ(userGetFn), authOpts);
    usersMe.addMethod('PUT', integ(userUpdateFn), authOpts);
    usersMe.addResource('listings').addMethod('GET', integ(userMeListingsFn), authOpts);
    usersMe.addResource('bookings').addMethod('GET', integ(userMeBookingsFn), authOpts);
    usersMe.addResource('metrics').addMethod('GET', integ(userMeMetricsFn), authOpts);
    usersMe.addResource('photo-url').addMethod('POST', integ(userPhotoUrlFn), authOpts);
    usersMe.addResource('payout').addMethod('POST', integ(payoutSetupFn), authOpts);
    usersMe.addResource('become-host').addMethod('POST', integ(userBecomeHostFn), authOpts);
    usersMe.addMethod('DELETE', integ(gdprDeleteFn), authOpts);
    usersMe.addResource('export').addMethod('GET', integ(gdprExportFn), authOpts);
    const invoicingResource = usersMe.addResource('invoicing');
    invoicingResource.addMethod('GET', integ(userInvoicingFn), authOpts);
    invoicingResource.addMethod('PUT', integ(userInvoicingFn), authOpts);

    // /api/v1/messages
    const messages = v1.addResource('messages');
    messages.addMethod('GET', integ(messagesListFn), authOpts);
    messages.addResource('unread-count').addMethod('GET', integ(messagesUnreadFn), authOpts);

    // /api/v1/admin — all admin routes use standard Cognito auth + in-Lambda admin group check
    const admin = v1.addResource('admin');

    const adminDisputes = admin.addResource('disputes');
    adminDisputes.addMethod('GET', integ(adminDisputesListFn), authOpts);
    const adminDisputeById = adminDisputes.addResource('{id}');
    adminDisputeById.addMethod('GET', integ(adminDisputeGetFn), authOpts);
    adminDisputeById.addResource('message').addMethod('POST', integ(adminDisputeMessageFn), authOpts);
    adminDisputeById.addResource('resolve').addMethod('POST', integ(adminDisputeResolveFn), authOpts);

    // Session 26 admin RC review routes and Session 28 platform fee routes are in SpotManagerStack.

    const adminCustomers = admin.addResource('customers');
    adminCustomers.addMethod('GET', integ(adminCustomersListFn), authOpts);
    const adminCustomerById = adminCustomers.addResource('{userId}');
    adminCustomerById.addMethod('GET', integ(adminCustomerGetFn), authOpts);
    adminCustomerById.addResource('suspend').addMethod('POST', integ(adminCustomerSuspendFn), authOpts);

    // /api/v1/translate — Session 29 on-demand translation
    v1.addResource('translate').addMethod('POST', integ(translateOnDemandFn), authOpts);

    // Session 26 Spot Manager routes are in SpotManagerStack.

    // Session 27 Block Reservations routes are hosted in BlockReservationsStack
    // under a separate RestApi (spotzy-block-api) to stay under CloudFormation
    // resource limits.

    // -----------------------------------------------------------------------
    // WebSocket API (API Gateway v2)
    // -----------------------------------------------------------------------
    this.webSocketApi = new apigatewayv2.CfnApi(this, 'SpotzyWebSocketApi', {
      name: `spotzy-ws${suffix}`,
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });

    const wsFnArn = (fn: lambda.Function) =>
      `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${fn.functionArn}/invocations`;

    const wsConnectInteg = new apigatewayv2.CfnIntegration(this, 'WsConnectInteg', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: wsFnArn(chatConnectFn),
    });
    const wsDisconnectInteg = new apigatewayv2.CfnIntegration(this, 'WsDisconnectInteg', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: wsFnArn(chatDisconnectFn),
    });
    const wsSendInteg = new apigatewayv2.CfnIntegration(this, 'WsSendInteg', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: wsFnArn(chatWsSendFn),
    });

    new apigatewayv2.CfnRoute(this, 'WsConnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$connect',
      authorizationType: 'NONE',
      target: `integrations/${wsConnectInteg.ref}`,
    });
    new apigatewayv2.CfnRoute(this, 'WsDisconnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$disconnect',
      authorizationType: 'NONE',
      target: `integrations/${wsDisconnectInteg.ref}`,
    });
    new apigatewayv2.CfnRoute(this, 'WsSendMessageRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: 'sendMessage',
      authorizationType: 'NONE',
      target: `integrations/${wsSendInteg.ref}`,
    });

    const wsStage = new apigatewayv2.CfnStage(this, 'WsStage', {
      apiId: this.webSocketApi.ref,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant API Gateway permission to invoke WebSocket Lambdas
    [chatConnectFn, chatDisconnectFn, chatWsSendFn].forEach((fn) => {
      fn.addPermission('WsInvokePermission', {
        principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/*`,
      });
    });

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'RestApiUrl', { value: this.restApi.url });
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'WebSocketApiId', { value: this.webSocketApi.ref });
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: `wss://${this.webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`,
    });
  }
}
