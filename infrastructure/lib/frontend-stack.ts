import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface FrontendStackProps extends cdk.StackProps {}

export class FrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly frontendBucket: s3.Bucket;
  public readonly mediaPublicBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: FrontendStackProps) {
    super(scope, id, props);

    const env = process.env.ENVIRONMENT ?? 'dev';
    const isProd = env === 'prod';
    const suffix = isProd ? '' : `-${env}`;
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const autoDeleteObjects = !isProd;

    // Domain aliases per environment
    const domainAliases: string[] = isProd
      ? ['spotzy.com', 'www.spotzy.com']
      : env === 'staging'
      ? ['staging.spotzy.com']
      : ['dev.spotzy.com'];

    // -----------------------------------------------------------------------
    // S3 Buckets (owned here so OAC grants stay within this stack)
    // -----------------------------------------------------------------------
    this.frontendBucket = new s3.Bucket(this, 'SpotzyFrontendBucket', {
      bucketName: `spotzy-frontend${suffix}`,
      removalPolicy,
      autoDeleteObjects,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    this.mediaPublicBucket = new s3.Bucket(this, 'SpotzyMediaPublicBucket', {
      bucketName: `spotzy-media-public${suffix}`,
      removalPolicy,
      autoDeleteObjects,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // ACM certificate ARN is injected per-environment via CDK context.
    // Must be in us-east-1 for CloudFront.
    // Usage: cdk deploy --context certificateArn=arn:aws:acm:us-east-1:...
    const certificateArn = this.node.tryGetContext('certificateArn') as string | undefined;
    const certificate = certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'SpotzyCert', certificateArn)
      : undefined;

    // -----------------------------------------------------------------------
    // WAF WebACL (must be in us-east-1 for CloudFront)
    // When deploying to a non-us-east-1 region, create this as a cross-region
    // stack and pass the WebACL ARN via context:
    //   cdk deploy --context webAclArn=arn:aws:wafv2:us-east-1:...
    // -----------------------------------------------------------------------
    const webAclArn = this.node.tryGetContext('webAclArn') as string | undefined;

    let wafAcl: wafv2.CfnWebACL | undefined;
    if (!webAclArn && this.region === 'us-east-1') {
      // Create WAF inline (only when stack is deployed in us-east-1)
      wafAcl = new wafv2.CfnWebACL(this, 'SpotzyWAF', {
        name: `spotzy-waf${suffix}`,
        scope: 'CLOUDFRONT',
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `spotzy-waf${suffix}`,
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            name: 'AWS-AWSManagedRulesCommonRuleSet',
            priority: 1,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'AWSManagedRulesCommonRuleSet',
              sampledRequestsEnabled: true,
            },
          },
          {
            name: 'AWS-AWSManagedRulesAmazonIpReputationList',
            priority: 2,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesAmazonIpReputationList',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'AWSManagedRulesAmazonIpReputationList',
              sampledRequestsEnabled: true,
            },
          },
        ],
      });
    }

    const resolvedWebAclId = webAclArn ?? wafAcl?.attrArn;

    // -----------------------------------------------------------------------
    // CloudFront Function — rewrite sub-directory requests to index.html
    // e.g. /search/ → /search/index.html, /auth/login → /auth/login/index.html
    // -----------------------------------------------------------------------
    const urlRewriteFn = new cloudfront.Function(this, 'UrlRewriteFunction', {
      functionName: `spotzy-url-rewrite${suffix}`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Rewrite dynamic Next.js routes to their placeholder paths
  // e.g. /listing/abc123/edit/ -> /listing/_/edit/
  var dynamicRoutes = [
    { pattern: /^\\/listing\\/([^\\/]+)\\/edit(\\/|$)/, rewrite: '/listing/_/edit/' },
    { pattern: /^\\/listing\\/([^\\/]+)\\/availability(\\/|$)/, rewrite: '/listing/_/availability/' },
    { pattern: /^\\/listing\\/([^\\/]+)(\\/?)$/, rewrite: '/listing/_/' },
    { pattern: /^\\/listings\\/([^\\/]+)\\/photos(\\/|$)/, rewrite: '/listings/_/photos/' },
    { pattern: /^\\/book\\/([^\\/]+)(\\/?)$/, rewrite: '/book/_/' },
    { pattern: /^\\/users\\/([^\\/]+)(\\/?)$/, rewrite: '/users/_/' },
    { pattern: /^\\/chat\\/([^\\/]+)(\\/?)$/, rewrite: '/chat/_/' },
    { pattern: /^\\/dispute\\/([^\\/]+)(\\/?)$/, rewrite: '/dispute/_/' }
  ];
  for (var i = 0; i < dynamicRoutes.length; i++) {
    if (dynamicRoutes[i].pattern.test(uri)) {
      uri = dynamicRoutes[i].rewrite;
      break;
    }
  }

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.split('/').pop().includes('.')) {
    request.uri = uri + '/index.html';
  } else {
    request.uri = uri;
  }
  return request;
}
      `.trim()),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // -----------------------------------------------------------------------
    // CloudFront Origin Access Controls
    // -----------------------------------------------------------------------
    const frontendOac = new cloudfront.S3OriginAccessControl(this, 'FrontendOAC', {
      description: 'OAC for Spotzy frontend bucket',
    });

    const mediaOac = new cloudfront.S3OriginAccessControl(this, 'MediaOAC', {
      description: 'OAC for Spotzy media-public bucket',
    });

    // -----------------------------------------------------------------------
    // CloudFront Distribution
    // -----------------------------------------------------------------------
    this.distribution = new cloudfront.Distribution(this, 'SpotzyDistribution', {
      comment: `Spotzy frontend CDN (${env})`,
      defaultRootObject: 'index.html',
      domainNames: certificate ? domainAliases : undefined,
      certificate,
      webAclId: resolvedWebAclId,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket, {
          originAccessControl: frontendOac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
        functionAssociations: [{
          function: urlRewriteFn,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      additionalBehaviors: {
        // /media/* served from spotzy-media-public bucket
        '/media/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.mediaPublicBucket, {
            originAccessControl: mediaOac,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          compress: true,
        },
      },
      errorResponses: [
        // SPA fallback — Next.js handles client-side routing
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableLogging: true,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
    });
    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.distribution.distributionDomainName,
    });
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
    });
  }
}
