import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly eventBus: events.EventBus;
  public readonly mediaUploadsBucket: s3.Bucket;
  public readonly mediaDisputesBucket: s3.Bucket;
  public readonly logsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = process.env.ENVIRONMENT ?? 'dev';
    const isProd = env === 'prod';
    const suffix = isProd ? '' : `-${env}`;
    const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN ?? (isProd ? 'spotzy.com' : 'di96dohl3v2d6.cloudfront.net');
    const appUrl = `https://${cloudfrontDomain}`;
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const autoDeleteObjects = !isProd;

    // -----------------------------------------------------------------------
    // DynamoDB single table
    // -----------------------------------------------------------------------
    this.table = new dynamodb.Table(this, 'SpotzyMainTable', {
      tableName: `spotzy-main${suffix}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
    });

    // GSI1 — general overloaded index (host→listings, spotter→bookings, etc.)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2 — geospatial index (listing search by geohash)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'geohash', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'listingId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // -----------------------------------------------------------------------
    // EventBridge custom bus (here so both ApiStack and IntegrationStack can
    // reference it without a circular dependency between those two stacks)
    // -----------------------------------------------------------------------
    this.eventBus = new events.EventBus(this, 'SpotzyEventBus', {
      eventBusName: `spotzy-events${suffix}`,
    });

    new events.Archive(this, 'SpotzyEventsArchive', {
      archiveName: `spotzy-events-archive${suffix}`,
      sourceEventBus: this.eventBus,
      retention: cdk.Duration.days(30),
      description: 'Archive of all Spotzy EventBridge events',
      eventPattern: { source: events.Match.prefix('') },
    });

    // -----------------------------------------------------------------------
    // S3 Buckets — logs bucket first (referenced by others for access logging)
    // -----------------------------------------------------------------------
    this.logsBucket = new s3.Bucket(this, 'SpotzyLogsBucket', {
      bucketName: `spotzy-logs${suffix}`,
      removalPolicy,
      autoDeleteObjects,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        { id: 'expire-old-logs', expiration: cdk.Duration.days(365) },
      ],
    });

    // spotzy-media-uploads — direct browser upload via presigned URL
    this.mediaUploadsBucket = new s3.Bucket(this, 'SpotzyMediaUploadsBucket', {
      bucketName: `spotzy-media-uploads${suffix}`,
      removalPolicy,
      autoDeleteObjects,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedOrigins: isProd ? ['https://spotzy.com', 'https://www.spotzy.com'] : [appUrl, 'http://localhost:3000'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        // Objects tagged validated=false are rejected — delete quickly
        {
          id: 'expire-rejected-uploads',
          expiration: cdk.Duration.days(1),
          tagFilters: { validated: 'false' },
        },
        // Objects tagged validated=pending were never processed — expire after 7 days
        // Note: S3 lifecycle cannot filter on absence-of-tag; objects uploaded without
        // any tag should be tagged 'validated=pending' by the upload presigner Lambda.
        {
          id: 'expire-pending-uploads',
          expiration: cdk.Duration.days(7),
          tagFilters: { validated: 'pending' },
        },
        // Clean up incomplete multipart uploads
        {
          id: 'abort-incomplete-multipart',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 'media-uploads/',
    });

    // spotzy-media-disputes — private evidence store
    this.mediaDisputesBucket = new s3.Bucket(this, 'SpotzyMediaDisputesBucket', {
      bucketName: `spotzy-media-disputes${suffix}`,
      removalPolicy,
      autoDeleteObjects,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: 'archive-to-glacier',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
        {
          id: 'expire-old-versions',
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 'media-disputes/',
    });

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'TableName', { value: this.table.tableName });
    new cdk.CfnOutput(this, 'TableArn', { value: this.table.tableArn });
    new cdk.CfnOutput(this, 'EventBusName', { value: this.eventBus.eventBusName });
    new cdk.CfnOutput(this, 'EventBusArn', { value: this.eventBus.eventBusArn });
    new cdk.CfnOutput(this, 'MediaUploadsBucketName', { value: this.mediaUploadsBucket.bucketName });
    new cdk.CfnOutput(this, 'MediaUploadsBucketArn', { value: this.mediaUploadsBucket.bucketArn });
    new cdk.CfnOutput(this, 'MediaDisputesBucketName', { value: this.mediaDisputesBucket.bucketName });
    new cdk.CfnOutput(this, 'MediaDisputesBucketArn', { value: this.mediaDisputesBucket.bucketArn });
    new cdk.CfnOutput(this, 'LogsBucketName', { value: this.logsBucket.bucketName });
  }
}
