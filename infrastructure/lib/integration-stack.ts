import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface IntegrationStackProps extends cdk.StackProps {
  eventBus: events.EventBus;
  mediaUploadsBucket: s3.Bucket;
}

export class IntegrationStack extends cdk.Stack {
  public readonly smsTopic: sns.Topic;
  public readonly sesConfigSet: ses.ConfigurationSet;

  constructor(scope: Construct, id: string, props: IntegrationStackProps) {
    super(scope, id, props);

    const { eventBus, mediaUploadsBucket } = props;

    const env = process.env.ENVIRONMENT ?? 'dev';
    const isProd = env === 'prod';
    const suffix = isProd ? '' : `-${env}`;
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // -----------------------------------------------------------------------
    // Helper: import Lambda by naming convention (avoids circular dependency
    // with ApiStack — Lambdas are identified by their agreed function names)
    // Cache imports so the same function referenced in multiple rules doesn't
    // create duplicate construct IDs.
    // -----------------------------------------------------------------------
    const fnCache = new Map<string, lambda.IFunction>();
    const fn = (shortName: string): lambda.IFunction => {
      if (fnCache.has(shortName)) return fnCache.get(shortName)!;
      const imported = lambda.Function.fromFunctionName(
        this,
        `Imported${shortName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`,
        `spotzy-${shortName}${suffix}`,
      );
      fnCache.set(shortName, imported);
      return imported;
    };

    // -----------------------------------------------------------------------
    // EventBridge rules
    // -----------------------------------------------------------------------

    // booking.created → availability-block, notify-sms, notify-email
    new events.Rule(this, 'BookingCreatedRule', {
      ruleName: `spotzy-booking-created${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy'],
        detailType: ['booking.created'],
      },
      targets: [
        new targets.LambdaFunction(fn('availability-block')),
        new targets.LambdaFunction(fn('notify-sms')),
        new targets.LambdaFunction(fn('notify-email')),
      ],
    });

    // booking.confirmed → notify-sms, notify-email (after payment)
    new events.Rule(this, 'BookingConfirmedRule', {
      ruleName: `spotzy-booking-confirmed${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy'],
        detailType: ['booking.confirmed'],
      },
      targets: [
        new targets.LambdaFunction(fn('notify-sms')),
        new targets.LambdaFunction(fn('notify-email')),
      ],
    });

    // booking.modified → availability-block, availability-release, notify-sms, notify-email
    new events.Rule(this, 'BookingModifiedRule', {
      ruleName: `spotzy-booking-modified${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy'],
        detailType: ['booking.modified'],
      },
      targets: [
        new targets.LambdaFunction(fn('availability-block')),
        new targets.LambdaFunction(fn('availability-release')),
        new targets.LambdaFunction(fn('notify-sms')),
        new targets.LambdaFunction(fn('notify-email')),
      ],
    });

    // booking.cancelled → availability-release, notify-sms, notify-email, payout-trigger
    new events.Rule(this, 'BookingCancelledRule', {
      ruleName: `spotzy-booking-cancelled${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy'],
        detailType: ['booking.cancelled'],
      },
      targets: [
        new targets.LambdaFunction(fn('availability-release')),
        new targets.LambdaFunction(fn('notify-sms')),
        new targets.LambdaFunction(fn('notify-email')),
        new targets.LambdaFunction(fn('payout-trigger')),
      ],
    });

    // booking.completed → payout-trigger, review-aggregate, preference-learn, notify-sms, notify-email
    new events.Rule(this, 'BookingCompletedRule', {
      ruleName: `spotzy-booking-completed${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy'],
        detailType: ['booking.completed'],
      },
      targets: [
        new targets.LambdaFunction(fn('payout-trigger')),
        new targets.LambdaFunction(fn('review-aggregate')),
        new targets.LambdaFunction(fn('preference-learn')),
        new targets.LambdaFunction(fn('notify-sms')),
        new targets.LambdaFunction(fn('notify-email')),
      ],
    });

    // dispute.created → notify-sms, notify-email
    new events.Rule(this, 'DisputeCreatedRule', {
      ruleName: `spotzy-dispute-created${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy'],
        detailType: ['dispute.created'],
      },
      targets: [
        new targets.LambdaFunction(fn('notify-sms')),
        new targets.LambdaFunction(fn('notify-email')),
      ],
    });

    // dispute.escalated → notify-sms, notify-email
    new events.Rule(this, 'DisputeEscalatedRule', {
      ruleName: `spotzy-dispute-escalated${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy'],
        detailType: ['dispute.escalated'],
      },
      targets: [
        new targets.LambdaFunction(fn('notify-sms')),
        new targets.LambdaFunction(fn('notify-email')),
      ],
    });

    // listing.published → notify-sms, notify-email
    new events.Rule(this, 'ListingPublishedRule', {
      ruleName: `spotzy-listing-published${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy'],
        detailType: ['listing.published'],
      },
      targets: [
        new targets.LambdaFunction(fn('notify-sms')),
        new targets.LambdaFunction(fn('notify-email')),
      ],
    });

    // review.created → review-aggregate, notify-sms, notify-email
    new events.Rule(this, 'ReviewCreatedRule', {
      ruleName: `spotzy-review-created${suffix}`,
      eventBus,
      eventPattern: {
        source: ['spotzy'],
        detailType: ['review.created'],
      },
      targets: [
        new targets.LambdaFunction(fn('review-aggregate')),
        new targets.LambdaFunction(fn('notify-sms')),
        new targets.LambdaFunction(fn('notify-email')),
      ],
    });

    // -----------------------------------------------------------------------
    // S3 event: photo uploaded → listing-ai-validate
    // -----------------------------------------------------------------------
    mediaUploadsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(fn('listing-ai-validate')),
      { prefix: 'listings/' },
    );

    // -----------------------------------------------------------------------
    // EventBridge Scheduler — daily booking completion check
    // Uses CfnSchedule (L1) as the L2 Scheduler construct is in alpha
    // -----------------------------------------------------------------------
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    const bookingCompleteCheckFn = fn('booking-cancel'); // reuse cancel fn as completion trigger
    // Note: replace 'booking-cancel' with a dedicated 'booking-complete-check' Lambda once implemented

    schedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [
        `arn:aws:lambda:${this.region}:${this.account}:function:spotzy-booking-cancel${suffix}`,
      ],
    }));

    new scheduler.CfnSchedule(this, 'DailyBookingCompletionCheck', {
      name: `spotzy-daily-booking-check${suffix}`,
      description: 'Checks for bookings ending in next 24h and marks them completed',
      scheduleExpression: 'cron(0 0 * * ? *)', // daily at midnight UTC
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: `arn:aws:lambda:${this.region}:${this.account}:function:spotzy-booking-cancel${suffix}`,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ source: 'scheduler', action: 'check-completions' }),
      },
    });

    // -----------------------------------------------------------------------
    // SNS Topics
    // -----------------------------------------------------------------------
    this.smsTopic = new sns.Topic(this, 'SpotzySmsTopic', {
      topicName: `spotzy-notifications-sms${suffix}`,
      displayName: 'Spotzy SMS Notifications',
    });

    // -----------------------------------------------------------------------
    // SES — email identity and configuration set
    // Domain must be verified externally; CDK registers the config set only
    // -----------------------------------------------------------------------
    this.sesConfigSet = new ses.ConfigurationSet(this, 'SpotzyEmailConfigSet', {
      configurationSetName: `spotzy-transactional${suffix}`,
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
      tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE,
    });

    new ses.EmailIdentity(this, 'SpotzyDomainIdentity', {
      identity: ses.Identity.domain('spotzy.com'),
      configurationSet: this.sesConfigSet,
    });

    // -----------------------------------------------------------------------
    // Secrets Manager — empty secrets to be filled manually
    // -----------------------------------------------------------------------
    const secretNames = [
      'spotzy/stripe/secret-key',
      'spotzy/stripe/webhook-secret',
      'spotzy/stripe/connect-client-id',
      'spotzy/mapbox/server-token',
      'spotzy/sns/sender-id',
    ];

    secretNames.forEach((name) => {
      new secretsmanager.Secret(this, `Secret${name.replace(/\//g, '-')}`, {
        secretName: `${name}${suffix}`,
        description: `Spotzy secret: ${name}`,
        removalPolicy,
      });
    });

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'SmsTopicArn', { value: this.smsTopic.topicArn });
  }
}
