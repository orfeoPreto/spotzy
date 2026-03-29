import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
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
  payoutSetup: 'payout-setup',
  userBecomeHost: 'user-become-host',
  availabilityBlock: 'availability-block',
  availabilityRelease: 'availability-release',
  notifySms: 'notify-sms',
  notifyEmail: 'notify-email',
  preferenceLearn: 'preference-learn',
  messagesList: 'messages-list',
  messagesUnread: 'messages-unread',
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
        'dispute-message': 'disputes/message',
        'dispute-escalate': 'disputes/escalate',
        'user-get': 'users/get',
        'user-update': 'users/update',
        'user-public-get': 'users/public-get',
        'user-me-listings': 'users/me-listings',
        'user-me-bookings': 'users/me-bookings',
        'user-me-metrics': 'users/me-metrics',
        'payout-setup': 'users/payout-setup',
        'user-become-host': 'users/become-host',
        'messages-list': 'messages/list',
        'messages-unread': 'messages/unread',
        'availability-block': 'availability/block',
        'availability-release': 'availability/release',
        'notify-sms': 'notifications/sms',
        'notify-email': 'notifications/email',
        'preference-learn': 'preferences/learn',
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
        logRetention: logs.RetentionDays.ONE_MONTH,
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
    const authRegisterFn      = mkFn('auth-register',       cognitoEnv);
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
    const disputeMessageFn = mkFn(LAMBDA_NAMES.disputeMessage);
    mkFn(LAMBDA_NAMES.disputeEscalate);

    const userGetFn        = mkFn(LAMBDA_NAMES.userGet);
    const userUpdateFn     = mkFn(LAMBDA_NAMES.userUpdate);
    const userPublicGetFn  = mkFn(LAMBDA_NAMES.userPublicGet);
    const userMeListingsFn = mkFn(LAMBDA_NAMES.userMeListings);
    const userMeBookingsFn = mkFn(LAMBDA_NAMES.userMeBookings);
    const userMeMetricsFn  = mkFn(LAMBDA_NAMES.userMeMetrics);
    const payoutSetupFn    = mkFn(LAMBDA_NAMES.payoutSetup, {
      APP_URL: `https://di96dohl3v2d6.cloudfront.net`,
    });
    const userBecomeHostFn = mkFn(LAMBDA_NAMES.userBecomeHost);

    const messagesListFn   = mkFn(LAMBDA_NAMES.messagesList);
    const messagesUnreadFn = mkFn(LAMBDA_NAMES.messagesUnread);

    mkFn(LAMBDA_NAMES.availabilityBlock);
    mkFn(LAMBDA_NAMES.availabilityRelease);
    mkFn(LAMBDA_NAMES.notifySms);
    mkFn(LAMBDA_NAMES.notifyEmail);
    mkFn(LAMBDA_NAMES.preferenceLearn);

    // Grant media bucket permissions
    mediaUploadsBucket.grantReadWrite(listingCreateFn);
    mediaUploadsBucket.grantPut(listingPhotoUrlFn);
    mediaPublicBucket.grantWrite(listingCreateFn);
    mediaPublicBucket.grantReadWrite(listingPhotoDeleteFn);
    mediaUploadsBucket.grantReadWrite(chatImageUrlFn);
    mediaPublicBucket.grantWrite(chatImageUrlFn);

    // ai-validate: read uploads, write public, call Rekognition
    mediaUploadsBucket.grantRead(listingAiValidateFn);
    mediaPublicBucket.grantPut(listingAiValidateFn);
    listingAiValidateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rekognition:DetectLabels', 'rekognition:DetectModerationLabels'],
      resources: ['*'],
    }));

    // payment-intent and payment-webhook need to read the Stripe secret key
    const stripeSecretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:spotzy/stripe/secret-key*`;
    const stripeWebhookSecretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:spotzy/stripe/webhook-secret*`;
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
        allowOrigins: ['https://spotzy.com', 'https://di96dohl3v2d6.cloudfront.net', 'http://localhost:3000'],
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
    usersMe.addResource('payout').addMethod('POST', integ(payoutSetupFn), authOpts);
    usersMe.addResource('become-host').addMethod('POST', integ(userBecomeHostFn), authOpts);

    // /api/v1/messages
    const messages = v1.addResource('messages');
    messages.addMethod('GET', integ(messagesListFn), authOpts);
    messages.addResource('unread-count').addMethod('GET', integ(messagesUnreadFn), authOpts);

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
