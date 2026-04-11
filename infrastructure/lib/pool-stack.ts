import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface PoolStackProps extends cdk.StackProps {
  table: dynamodb.Table;
  eventBus: events.EventBus;
}

export class PoolStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PoolStackProps) {
    super(scope, id, props);

    const env = process.env.ENVIRONMENT ?? 'dev';
    const isProd = env === 'prod';
    const suffix = isProd ? '' : `-${env}`;
    const { table, eventBus } = props;
    const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN ?? (isProd ? 'spotzy.com' : 'di96dohl3v2d6.cloudfront.net');

    const restApi = new apigateway.RestApi(this, 'SpotzyPoolApi', {
      restApiName: `spotzy-pool-api${suffix}`,
      deployOptions: { stageName: 'prod' },
      defaultCorsPreflightOptions: {
        allowOrigins: isProd ? [`https://${cloudfrontDomain}`] : ['http://localhost:3000', `https://${cloudfrontDomain}`],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const dirMap: Record<string, string> = {
      'pool-create': 'pools/create',
      'pool-spot-add': 'pools/spot-add',
      'pool-booking-create': 'pools/booking-create',
      'pool-dashboard': 'pools/dashboard',
      'corp-create': 'corporate/create',
      'corp-member-add': 'corporate/member-add',
      'lock-connect': 'locks/connect',
      'lock-access-code-generate': 'locks/access-code-generate',
      'lock-access-code-revoke': 'locks/access-code-revoke',
    };

    const mkFn = (shortName: string, extraEnv?: Record<string, string>): lambda.Function => {
      const dir = dirMap[shortName]!;
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

    const integ = (fn: lambda.Function) => new apigateway.LambdaIntegration(fn);
    const authOpts: apigateway.MethodOptions = { authorizationType: apigateway.AuthorizationType.NONE }; // TODO: add Cognito auth

    // Pool routes
    const v1 = restApi.root.addResource('api').addResource('v1');
    const pools = v1.addResource('pools');
    pools.addMethod('POST', integ(mkFn('pool-create')), authOpts);

    const poolById = pools.addResource('{poolId}');
    poolById.addResource('spots').addMethod('POST', integ(mkFn('pool-spot-add')), authOpts);
    poolById.addResource('bookings').addMethod('POST', integ(mkFn('pool-booking-create')), authOpts);
    poolById.addResource('dashboard').addMethod('GET', integ(mkFn('pool-dashboard')), authOpts);

    // Corporate routes
    const corporate = v1.addResource('corporate');
    corporate.addMethod('POST', integ(mkFn('corp-create')), authOpts);
    const corpById = corporate.addResource('{corpId}');
    corpById.addResource('members').addMethod('POST', integ(mkFn('corp-member-add')), authOpts);

    // Lock routes
    const listings = v1.addResource('listings');
    const listingById = listings.addResource('{id}');
    listingById.addResource('lock').addMethod('POST', integ(mkFn('lock-connect')), authOpts);

    // EventBridge rules for access code lifecycle
    const targets = require('aws-cdk-lib/aws-events-targets');
    const accessCodeGenerateFn = mkFn('lock-access-code-generate');
    const accessCodeRevokeFn = mkFn('lock-access-code-revoke');

    new events.Rule(this, 'AccessCodeGenerateRule', {
      eventBus, eventPattern: { detailType: ['booking.confirmed'] },
      targets: [new targets.LambdaFunction(accessCodeGenerateFn)],
    });

    new events.Rule(this, 'AccessCodeRevokeRule', {
      eventBus, eventPattern: { detailType: ['booking.cancelled', 'booking.completed'] },
      targets: [new targets.LambdaFunction(accessCodeRevokeFn)],
    });

    new cdk.CfnOutput(this, 'PoolApiUrl', { value: restApi.url });
  }
}
