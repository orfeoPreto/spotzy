#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { IntegrationStack } from '../lib/integration-stack';
import { ObservabilityStack } from '../lib/observability-stack';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// -------------------------------------------------------------------------
// Stack instantiation order:
//   DataStack (table + eventBus) → ApiStack (lambdas) → IntegrationStack (rules)
//   FrontendStack and ObservabilityStack are independent
// -------------------------------------------------------------------------

const dataStack = new DataStack(app, 'SpotzyDataStack', { env });

const apiStack = new ApiStack(app, 'SpotzyApiStack', {
  env,
  table: dataStack.table,
  eventBus: dataStack.eventBus,
  mediaUploadsBucket: dataStack.mediaUploadsBucket,
});

// IntegrationStack wires EventBridge rules to Lambda functions by name.
// It must deploy AFTER ApiStack so Lambda functions exist before EventBridge
// tries to create Lambda::Permission resources.
const integrationStack = new IntegrationStack(app, 'SpotzyIntegrationStack', {
  env,
  eventBus: dataStack.eventBus,
  mediaUploadsBucket: dataStack.mediaUploadsBucket,
});

// FrontendStack is independent — it creates its own buckets so CloudFront OAC
// grants stay within a single stack (avoids a DataStack ↔ FrontendStack cycle).
const frontendStack = new FrontendStack(app, 'SpotzyFrontendStack', { env });

new ObservabilityStack(app, 'SpotzyObservabilityStack', {
  env,
  api: apiStack.restApi,
  table: dataStack.table,
});

// Explicit dependency ordering ensures correct CloudFormation deploy sequence
apiStack.addDependency(dataStack);
integrationStack.addDependency(apiStack);  // Lambdas must exist before EventBridge permissions
// FrontendStack is self-contained — no explicit dependency needed
