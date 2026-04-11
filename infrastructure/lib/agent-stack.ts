import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as scheduler_targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';

export interface AgentStackProps extends cdk.StackProps {
  table: dynamodb.Table;
  eventBus: events.EventBus;
}

export class AgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const env = process.env.ENVIRONMENT ?? 'dev';
    const isProd = env === 'prod';
    const suffix = isProd ? '' : `-${env}`;
    const { table, eventBus } = props;

    const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN ?? (isProd ? 'spotzy.com' : 'di96dohl3v2d6.cloudfront.net');

    // Standalone Agent REST API
    const restApi = new apigateway.RestApi(this, 'SpotzyAgentApi', {
      restApiName: `spotzy-agent-api${suffix}`,
      deployOptions: { stageName: 'prod' },
      defaultCorsPreflightOptions: {
        allowOrigins: isProd
          ? [`https://${cloudfrontDomain}`]
          : ['http://localhost:3000', `https://${cloudfrontDomain}`],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Handler path mapping
    const dirMap: Record<string, string> = {
      'api-key-authorizer': 'auth/api-key-authorizer',
      'agent-keys': 'agent/keys',
      'agent-search': 'agent/search',
      'agent-quote': 'agent/quote',
      'agent-bookings-create': 'agent/bookings-create',
      'agent-bookings-list': 'agent/bookings-list',
      'agent-bookings-cancel': 'agent/bookings-cancel',
      'agent-messages': 'agent/messages',
      'agent-preferences': 'agent/preferences',
      'agent-webhooks': 'agent/webhooks',
      'agent-webhook-delivery': 'agent/webhook-delivery',
      'agent-openapi': 'agent/openapi',
    };

    const mkFn = (shortName: string, extraEnv?: Record<string, string>): lambda.Function => {
      const dir = dirMap[shortName];
      if (!dir) throw new Error(`No handler path for agent Lambda: ${shortName}`);
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

    // --- Lambda authorizer ---
    const apiKeyAuthorizerFn = mkFn('api-key-authorizer');
    const authorizer = new apigateway.TokenAuthorizer(this, 'ApiKeyAuthorizer', {
      handler: apiKeyAuthorizerFn,
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    const agentAuthOpts: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer,
    };

    // --- Agent Lambdas ---
    const agentKeysFn = mkFn('agent-keys');
    const agentSearchFn = mkFn('agent-search');
    const agentQuoteFn = mkFn('agent-quote');
    const agentBookingsCreateFn = mkFn('agent-bookings-create');
    const agentBookingsListFn = mkFn('agent-bookings-list');
    const agentBookingsCancelFn = mkFn('agent-bookings-cancel');
    const agentMessagesFn = mkFn('agent-messages');
    const agentPreferencesFn = mkFn('agent-preferences');
    const agentWebhooksFn = mkFn('agent-webhooks');
    const agentOpenapiFn = mkFn('agent-openapi');

    const integ = (fn: lambda.Function) => new apigateway.LambdaIntegration(fn);
    const publicOpts: apigateway.MethodOptions = { authorizationType: apigateway.AuthorizationType.NONE };

    // --- Routes ---
    const v1 = restApi.root.addResource('api').addResource('v1');
    const agent = v1.addResource('agent');

    // Output the agent API URL
    new cdk.CfnOutput(this, 'AgentApiUrl', {
      value: restApi.url,
      description: 'Agent API base URL',
    });

    // Search
    agent.addResource('search').addMethod('GET', integ(agentSearchFn), agentAuthOpts);

    // Quote
    const agentListings = agent.addResource('listings');
    const agentListingById = agentListings.addResource('{listingId}');
    agentListingById.addResource('quote').addMethod('GET', integ(agentQuoteFn), agentAuthOpts);

    // Bookings
    const agentBookings = agent.addResource('bookings');
    agentBookings.addMethod('POST', integ(agentBookingsCreateFn), agentAuthOpts);
    agentBookings.addMethod('GET', integ(agentBookingsListFn), agentAuthOpts);

    const agentBookingById = agentBookings.addResource('{bookingId}');
    agentBookingById.addResource('cancel').addMethod('POST', integ(agentBookingsCancelFn), agentAuthOpts);
    const agentBookingMessages = agentBookingById.addResource('messages');
    agentBookingMessages.addMethod('GET', integ(agentMessagesFn), agentAuthOpts);
    agentBookingMessages.addMethod('POST', integ(agentMessagesFn), agentAuthOpts);

    // Preferences
    const agentPrefs = agent.addResource('preferences');
    agentPrefs.addMethod('GET', integ(agentPreferencesFn), agentAuthOpts);
    agentPrefs.addMethod('PUT', integ(agentPreferencesFn), agentAuthOpts);

    // API Keys (uses Cognito auth, not API key auth — users manage keys via web)
    const keys = agent.addResource('keys');
    keys.addMethod('POST', integ(agentKeysFn), agentAuthOpts);
    keys.addMethod('GET', integ(agentKeysFn), agentAuthOpts);
    keys.addResource('{keyId}').addMethod('DELETE', integ(agentKeysFn), agentAuthOpts);

    // Webhooks
    const webhooks = agent.addResource('webhooks');
    webhooks.addMethod('POST', integ(agentWebhooksFn), agentAuthOpts);
    webhooks.addMethod('GET', integ(agentWebhooksFn), agentAuthOpts);
    webhooks.addResource('{webhookId}').addMethod('DELETE', integ(agentWebhooksFn), agentAuthOpts);

    // OpenAPI spec (public — no auth)
    agent.addResource('openapi.yaml').addMethod('GET', integ(agentOpenapiFn), publicOpts);

    // --- Webhook delivery Lambda (EventBridge target) ---
    const agentWebhookDeliveryFn = mkFn('agent-webhook-delivery');

    // EventBridge rule to route events to webhook delivery
    new events.Rule(this, 'WebhookDeliveryRule', {
      eventBus,
      eventPattern: {
        source: ['spotzy'],
      },
      targets: [new (require('aws-cdk-lib/aws-events-targets').LambdaFunction)(agentWebhookDeliveryFn)],
    });

    // ── Monthly spending reset Lambda + EventBridge Scheduler ──────────
    const apiKeyResetFn = new lambdaNodejs.NodejsFunction(this, 'ApiKeyMonthlyResetFn', {
      functionName: `spotzy-apikey-monthly-reset${suffix}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../backend/functions/agent/apikey-monthly-reset/index.ts'),
      handler: 'handler',
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      bundling: { minify: true, sourceMap: true, externalModules: [] },
      environment: {
        TABLE_NAME: table.tableName,
        ENVIRONMENT: env,
      },
    });
    table.grantReadWriteData(apiKeyResetFn);
    apiKeyResetFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    const resetSchedulerRole = new iam.Role(this, 'ApiKeyResetSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    apiKeyResetFn.grantInvoke(resetSchedulerRole);

    new scheduler.CfnSchedule(this, 'ApiKeyResetSchedule', {
      name: `spotzy-apikey-monthly-reset${suffix}`,
      scheduleExpression: 'cron(0 0 1 * ? *)',
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: apiKeyResetFn.functionArn,
        roleArn: resetSchedulerRole.roleArn,
        input: JSON.stringify({ source: 'monthly-cron' }),
      },
    });

    // ── Hosted MCP server Lambda ──────────────────────────────────────
    // NOTE: The hosted MCP server requires ALB infrastructure (VPC, ALB, ACM cert, Route53).
    // The Lambda is defined here; ALB provisioning requires a domain name and hosted zone
    // which should be configured per environment. See documentation/prompts/21b_agent_integration_supplement.md
    // for the full ALB + Route53 CDK template.
    const mcpHostedFn = new lambdaNodejs.NodejsFunction(this, 'McpServerHostedFn', {
      functionName: `spotzy-mcp-server-hosted${suffix}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../backend/functions/agent/mcp-server-hosted/index.ts'),
      handler: 'handler',
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(900),
      memorySize: 1024,
      bundling: { minify: true, sourceMap: true, externalModules: [] },
      environment: {
        TABLE_NAME: table.tableName,
        AGENT_API_BASE_URL: restApi.url,
        ENVIRONMENT: env,
      },
    });
    table.grantReadData(mcpHostedFn);

    // Lambda Function URL for response streaming (used by ALB as target)
    mcpHostedFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    new cdk.CfnOutput(this, 'McpServerHostedFnArn', {
      value: mcpHostedFn.functionArn,
      description: 'Hosted MCP server Lambda ARN (attach to ALB target group)',
    });
  }
}
