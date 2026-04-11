#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { IntegrationStack } from '../lib/integration-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { AgentStack } from '../lib/agent-stack';
import { PoolStack } from '../lib/pool-stack';
import { BlockReservationsStack } from '../lib/block-reservations-stack';
import { SpotManagerStack } from '../lib/spot-manager-stack';

const app = new cdk.App();

const envName = process.env.ENVIRONMENT ?? 'dev';
// Existing dev stacks were deployed without suffix — keep them as-is for backwards compatibility
const stackSuffix = (envName === 'prod' || envName === 'dev') ? '' : `-${envName}`;

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// -------------------------------------------------------------------------
// Stack instantiation order:
//   DataStack (table + eventBus) → ApiStack (lambdas) → IntegrationStack (rules)
//   FrontendStack and ObservabilityStack are independent
// -------------------------------------------------------------------------

const dataStack = new DataStack(app, `SpotzyDataStack${stackSuffix}`, { env });

const apiStack = new ApiStack(app, `SpotzyApiStack${stackSuffix}`, {
  env,
  table: dataStack.table,
  eventBus: dataStack.eventBus,
  mediaUploadsBucket: dataStack.mediaUploadsBucket,
});

// IntegrationStack wires EventBridge rules to Lambda functions by name.
// It must deploy AFTER ApiStack so Lambda functions exist before EventBridge
// tries to create Lambda::Permission resources.
const integrationStack = new IntegrationStack(app, `SpotzyIntegrationStack${stackSuffix}`, {
  env,
  eventBus: dataStack.eventBus,
  mediaUploadsBucket: dataStack.mediaUploadsBucket,
});

// FrontendStack is independent — it creates its own buckets so CloudFront OAC
// grants stay within a single stack (avoids a DataStack ↔ FrontendStack cycle).
const frontendStack = new FrontendStack(app, `SpotzyFrontendStack${stackSuffix}`, { env });

new ObservabilityStack(app, `SpotzyObservabilityStack${stackSuffix}`, {
  env,
  api: apiStack.restApi,
  table: dataStack.table,
});

const agentStack = new AgentStack(app, `SpotzyAgentStack${stackSuffix}`, {
  env,
  table: dataStack.table,
  eventBus: dataStack.eventBus,
});

const poolStack = new PoolStack(app, `SpotzyPoolStack${stackSuffix}`, {
  env,
  table: dataStack.table,
  eventBus: dataStack.eventBus,
});

// Session 26 Spot Manager stack — separated from ApiStack to stay under
// the 500 resources/stack CloudFormation limit.
const spotManagerStack = new SpotManagerStack(app, `SpotzySpotManagerStack${stackSuffix}`, {
  env,
  table: dataStack.table,
  eventBus: dataStack.eventBus,
  userPool: apiStack.userPool,
});

// Session 27 Block Reservations stack — separated from ApiStack to stay under
// the 500 resources/stack CloudFormation limit.
const blockReservationsStack = new BlockReservationsStack(app, `SpotzyBlockReservationsStack${stackSuffix}`, {
  env,
  table: dataStack.table,
  eventBus: dataStack.eventBus,
  userPool: apiStack.userPool,
});

// Explicit dependency ordering ensures correct CloudFormation deploy sequence
apiStack.addDependency(dataStack);
agentStack.addDependency(dataStack);       // Agent stack needs DynamoDB table + EventBus
poolStack.addDependency(dataStack);        // Pool stack needs DynamoDB table + EventBus
spotManagerStack.addDependency(dataStack);        // needs table + eventBus
spotManagerStack.addDependency(apiStack);         // needs Cognito UserPool from ApiStack
blockReservationsStack.addDependency(dataStack);  // needs table + eventBus
blockReservationsStack.addDependency(apiStack);   // needs Cognito UserPool from ApiStack
integrationStack.addDependency(apiStack);  // Lambdas must exist before EventBridge permissions
// FrontendStack is self-contained — no explicit dependency needed
