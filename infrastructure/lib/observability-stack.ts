import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  api: apigateway.RestApi;
  table: dynamodb.Table;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly alarmsTopic: sns.Topic;
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { api, table } = props;

    const env = process.env.ENVIRONMENT ?? 'dev';
    const isProd = env === 'prod';
    const suffix = `-${env}`;

    // -----------------------------------------------------------------------
    // SNS topic for alarm notifications (PagerDuty / OpsGenie integration)
    // -----------------------------------------------------------------------
    this.alarmsTopic = new sns.Topic(this, 'SpotzyAlarmsTopic', {
      topicName: `spotzy-alarms${suffix}`,
      displayName: 'Spotzy Infrastructure Alarms',
    });

    const alarmAction = new cloudwatchActions.SnsAction(this.alarmsTopic);

    // -----------------------------------------------------------------------
    // Lambda error alarms — critical business functions
    // Threshold: > 5 errors in 5 minutes
    // -----------------------------------------------------------------------
    const criticalFunctions = [
      'booking-create',
      'payment-intent',
      'payment-webhook',
    ] as const;

    const lambdaErrorAlarms = criticalFunctions.map((fnName) => {
      const alarm = new cloudwatch.Alarm(this, `LambdaErrors-${fnName}`, {
        alarmName: `spotzy-lambda-errors-${fnName}${suffix}`,
        alarmDescription: `Lambda ${fnName} has > 5 errors in 5 minutes`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: { FunctionName: `spotzy-${fnName}${suffix}` },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 5,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });
      alarm.addAlarmAction(alarmAction);
      return alarm;
    });

    // -----------------------------------------------------------------------
    // API Gateway alarms
    // -----------------------------------------------------------------------
    const apiNameDims = { ApiName: api.restApiName, Stage: 'prod' };

    const api5xxAlarm = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      alarmName: `spotzy-api-5xx-rate${suffix}`,
      alarmDescription: 'API Gateway 5xx error rate > 1% over 5 minutes',
      metric: new cloudwatch.MathExpression({
        expression: '(errors / requests) * 100',
        usingMetrics: {
          errors: new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5XXError',
            dimensionsMap: apiNameDims,
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          requests: new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: apiNameDims,
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    api5xxAlarm.addAlarmAction(alarmAction);

    const apiLatencyAlarm = new cloudwatch.Alarm(this, 'ApiLatencyAlarm', {
      alarmName: `spotzy-api-p99-latency${suffix}`,
      alarmDescription: 'API Gateway P99 latency > 3 seconds',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'IntegrationLatency',
        dimensionsMap: apiNameDims,
        statistic: 'p99',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3000,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    apiLatencyAlarm.addAlarmAction(alarmAction);

    // -----------------------------------------------------------------------
    // DynamoDB system errors alarm
    // -----------------------------------------------------------------------
    const dynamoErrorAlarm = new cloudwatch.Alarm(this, 'DynamoSystemErrors', {
      alarmName: `spotzy-dynamodb-system-errors${suffix}`,
      alarmDescription: 'DynamoDB system errors detected',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'SystemErrors',
        dimensionsMap: { TableName: table.tableName },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    dynamoErrorAlarm.addAlarmAction(alarmAction);

    // -----------------------------------------------------------------------
    // CloudWatch Dashboard: Spotzy-MVP
    // -----------------------------------------------------------------------
    this.dashboard = new cloudwatch.Dashboard(this, 'SpotzyDashboard', {
      dashboardName: `Spotzy-MVP${suffix}`,
    });

    // All Lambda function names (must match mkFn naming convention in ApiStack)
    const allFunctions = [
      'listing-create', 'listing-search', 'listing-get', 'listing-update',
      'listing-publish', 'listing-photo-url', 'listing-ai-validate',
      'booking-create', 'booking-get', 'booking-modify', 'booking-cancel',
      'payment-intent', 'payment-webhook', 'payout-trigger',
      'chat-get', 'chat-send', 'chat-connect', 'chat-disconnect',
      'review-create', 'review-aggregate',
      'dispute-create', 'dispute-message', 'dispute-escalate',
      'user-get', 'user-update', 'payout-setup',
      'availability-block', 'availability-release',
      'notify-sms', 'notify-email', 'preference-learn',
    ];

    const mkLambdaMetric = (fnName: string, metricName: string) =>
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName,
        dimensionsMap: { FunctionName: `spotzy-${fnName}${suffix}` },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
        label: fnName,
      });

    // Row 1: Alarm status
    this.dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'Active Alarms',
        alarms: [
          api5xxAlarm,
          apiLatencyAlarm,
          dynamoErrorAlarm,
          ...lambdaErrorAlarms,
        ],
        width: 24,
      }),
    );

    // Row 2: API Gateway overview
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway — Request Count',
        left: [new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Count',
          dimensionsMap: apiNameDims,
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
        })],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway — Error Rates',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4XXError',
            dimensionsMap: apiNameDims,
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            label: '4XX',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5XXError',
            dimensionsMap: apiNameDims,
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            label: '5XX',
          }),
        ],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway — Latency P50/P99',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'IntegrationLatency',
            dimensionsMap: apiNameDims,
            statistic: 'p50',
            period: cdk.Duration.minutes(1),
            label: 'P50',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'IntegrationLatency',
            dimensionsMap: apiNameDims,
            statistic: 'p99',
            period: cdk.Duration.minutes(1),
            label: 'P99',
          }),
        ],
        width: 8,
      }),
    );

    // Row 3: Lambda invocations
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda — Invocations (all functions)',
        left: allFunctions.map((n) => mkLambdaMetric(n, 'Invocations')),
        width: 12,
        view: cloudwatch.GraphWidgetView.TIME_SERIES,
        stacked: false,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda — Errors (all functions)',
        left: allFunctions.map((n) => mkLambdaMetric(n, 'Errors')),
        width: 12,
        view: cloudwatch.GraphWidgetView.TIME_SERIES,
        stacked: false,
      }),
    );

    // Row 4: DynamoDB
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB — Read Capacity Units',
        left: [new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ConsumedReadCapacityUnits',
          dimensionsMap: { TableName: table.tableName },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
        })],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB — Write Capacity Units',
        left: [new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ConsumedWriteCapacityUnits',
          dimensionsMap: { TableName: table.tableName },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
        })],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB — Latency',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: { TableName: table.tableName, Operation: 'GetItem' },
            statistic: 'p99',
            period: cdk.Duration.minutes(1),
            label: 'GetItem P99',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: { TableName: table.tableName, Operation: 'PutItem' },
            statistic: 'p99',
            period: cdk.Duration.minutes(1),
            label: 'PutItem P99',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: { TableName: table.tableName, Operation: 'Query' },
            statistic: 'p99',
            period: cdk.Duration.minutes(1),
            label: 'Query P99',
          }),
        ],
        width: 8,
      }),
    );

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home#dashboards:name=Spotzy-MVP${suffix}`,
    });
    new cdk.CfnOutput(this, 'AlarmsTopicArn', { value: this.alarmsTopic.topicArn });
  }
}
