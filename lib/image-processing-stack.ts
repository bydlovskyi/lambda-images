import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';
import { RECORD_TTL_DAYS } from '../types/image-record';

/** How long the resize worker may run; SQS visibility is derived from this. */
const RESIZE_TIMEOUT = cdk.Duration.seconds(60);
/** AWS recommends visibility timeout ≥ 6× the function timeout for Lambda consumers. */
const QUEUE_VISIBILITY_TIMEOUT = cdk.Duration.seconds(RESIZE_TIMEOUT.toSeconds() * 6);
/** Attempts before a message is parked in the dead-letter queue. */
const MAX_RECEIVE_COUNT = 3;

const LOG_RETENTION = logs.RetentionDays.TWO_WEEKS;
const RUNTIME = lambda.Runtime.NODEJS_22_X;
const ARCHITECTURE = lambda.Architecture.ARM_64;

/**
 * The AWS SDK v3 ships with the Node.js runtime, so it is left out of every bundle.
 * Trade-off: smaller assets and faster cold starts, but the SDK version follows Lambda
 * runtime updates rather than package.json. Set `bundleAwsSDK: true` instead to pin it.
 */
const EXTERNAL_MODULES = ['@aws-sdk/*'];

/** Pin the Sharp build to the Lambda platform, whatever the host that runs `cdk synth`. */
const SHARP_VERSION: string = require('../package.json').dependencies.sharp;
const SHARP_PLATFORM = { os: 'linux', cpu: 'arm64', libc: 'glibc' } as const;

export interface ImageProcessingStackProps extends cdk.StackProps {
  /** Email address subscribed to the DLQ alarm topic. Omit to create the topic without subscribers. */
  readonly alarmEmail?: string;
}

export class ImageProcessingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ImageProcessingStackProps = {}) {
    super(scope, id, props);

    // ---------------------------------------------------------------- Storage

    const uploadBucket = new s3.Bucket(this, 'UploadBucket', {
      bucketName: `image-upload-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // Originals are only needed until they are processed; expire them with the record.
      lifecycleRules: [{ expiration: cdk.Duration.days(RECORD_TTL_DAYS) }],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    const processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      bucketName: `image-processed-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(RECORD_TTL_DAYS) }],
    });

    const table = new dynamodb.Table(this, 'ImageTable', {
      tableName: 'ImageProcessingTable',
      partitionKey: { name: 'imageId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Every record is written with `expiresAt` (see ImageRecord / process-upload.ts).
      timeToLiveAttribute: 'expiresAt',
    });

    // ---------------------------------------------------------------- Queue

    const deadLetterQueue = new sqs.Queue(this, 'ImageProcessingDLQ', {
      queueName: 'ImageProcessingDLQ',
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    });

    const queue = new sqs.Queue(this, 'ImageProcessingQueue', {
      queueName: 'ImageProcessingQueue',
      visibilityTimeout: QUEUE_VISIBILITY_TIMEOUT,
      retentionPeriod: cdk.Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: MAX_RECEIVE_COUNT },
    });

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'ImageProcessing-Alarms',
      displayName: 'Image processing pipeline alarms',
    });
    if (props.alarmEmail) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(props.alarmEmail));
    }

    const dlqAlarm = new cloudwatch.Alarm(this, 'DeadLetterQueueAlarm', {
      alarmName: 'ImageProcessing-DLQ-NotEmpty',
      alarmDescription: 'Messages have exhausted their retries and need manual attention',
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));
    dlqAlarm.addOkAction(new cloudwatchActions.SnsAction(alarmTopic));

    // ---------------------------------------------------------------- Functions

    const getUploadUrlFn = this.createFunction('GetUploadUrl', 'get-upload-url.ts', {
      environment: { UPLOAD_BUCKET_NAME: uploadBucket.bucketName },
    });
    uploadBucket.grantPut(getUploadUrlFn, 'uploads/*');

    const processUploadFn = this.createFunction('ProcessUpload', 'process-upload.ts', {
      environment: { TABLE_NAME: table.tableName, QUEUE_URL: queue.queueUrl },
    });
    processUploadFn.addEventSource(
      new lambdaEventSources.S3EventSource(uploadBucket, {
        events: [s3.EventType.OBJECT_CREATED],
        filters: [{ prefix: 'uploads/' }],
      })
    );
    table.grantWriteData(processUploadFn);
    queue.grantSendMessages(processUploadFn);

    const resizeImageFn = this.createFunction('ResizeImage', 'resize-image.ts', {
      environment: { TABLE_NAME: table.tableName, PROCESSED_BUCKET_NAME: processedBucket.bucketName },
      timeout: RESIZE_TIMEOUT,
      memorySize: 1024,
      bundling: {
        // Sharp ships native binaries, so it cannot be bundled by esbuild. Install the
        // Lambda-platform build into the asset explicitly rather than the host's build.
        externalModules: [...EXTERNAL_MODULES, 'sharp'],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          // Each entry runs in its own shell from the project root, so keep this one chained command.
          afterBundling: (_inputDir, outputDir) => [
            [
              `cd "${outputDir}"`,
              "echo '{}' > package.json",
              `npm install --os=${SHARP_PLATFORM.os} --cpu=${SHARP_PLATFORM.cpu} --libc=${SHARP_PLATFORM.libc} ` +
                `--no-save --no-package-lock --omit=dev --silent sharp@${SHARP_VERSION}`,
              `test -d node_modules/@img/sharp-${SHARP_PLATFORM.os}-${SHARP_PLATFORM.cpu} ` +
                `|| { echo 'sharp ${SHARP_PLATFORM.os}-${SHARP_PLATFORM.cpu} install failed or binary missing (npm >= 10.4 is required for cross-platform installs)' >&2; exit 1; }`,
              // The wasm fallback is ~20 MB and never used on Lambda.
              'rm -rf package.json node_modules/@img/sharp-wasm32',
            ].join(' && '),
          ],
        },
      },
    });
    resizeImageFn.addEventSource(
      new lambdaEventSources.SqsEventSource(queue, {
        batchSize: 1,
        maxConcurrency: 10,
      })
    );
    uploadBucket.grantRead(resizeImageFn, 'uploads/*');
    processedBucket.grantPut(resizeImageFn, 'processed/*');
    table.grantWriteData(resizeImageFn);

    const getStatusFn = this.createFunction('GetStatus', 'get-status.ts', {
      environment: { TABLE_NAME: table.tableName, PROCESSED_BUCKET_NAME: processedBucket.bucketName },
    });
    table.grantReadData(getStatusFn);
    processedBucket.grantRead(getStatusFn, 'processed/*');

    // ---------------------------------------------------------------- API

    const httpApi = new apigatewayv2.HttpApi(this, 'ImageProcessingApi', {
      apiName: 'ImageProcessingApi',
      description: 'HTTP API for the image processing pipeline',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.POST],
        allowHeaders: ['Content-Type'],
      },
    });

    httpApi.addRoutes({
      path: '/upload',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration('GetUploadUrlIntegration', getUploadUrlFn),
    });
    httpApi.addRoutes({
      path: '/status',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration('GetStatusIntegration', getStatusFn),
    });

    // ---------------------------------------------------------------- Outputs

    new cdk.CfnOutput(this, 'ApiEndpoint', { value: httpApi.url!, description: 'HTTP API base URL' });
    new cdk.CfnOutput(this, 'UploadEndpoint', { value: `${httpApi.url}upload`, description: 'POST — request a presigned upload URL' });
    new cdk.CfnOutput(this, 'StatusEndpoint', { value: `${httpApi.url}status`, description: 'GET — poll processing status' });
    new cdk.CfnOutput(this, 'UploadBucketName', { value: uploadBucket.bucketName, description: 'S3 bucket for originals' });
    new cdk.CfnOutput(this, 'ProcessedBucketName', { value: processedBucket.bucketName, description: 'S3 bucket for resized images' });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName, description: 'DynamoDB status table' });
    new cdk.CfnOutput(this, 'QueueUrl', { value: queue.queueUrl, description: 'SQS processing queue' });
    new cdk.CfnOutput(this, 'DeadLetterQueueUrl', { value: deadLetterQueue.queueUrl, description: 'SQS dead-letter queue' });
    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: alarmTopic.topicArn, description: 'SNS topic notified when the DLQ is not empty' });
  }

  /** Common wiring for every Lambda: runtime, architecture, log group with retention. */
  private createFunction(
    name: string,
    entryFile: string,
    props: Partial<nodejs.NodejsFunctionProps>
  ): nodejs.NodejsFunction {
    const functionName = `ImageProcessing-${name}`;
    const logGroup = new logs.LogGroup(this, `${name}LogGroup`, {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: LOG_RETENTION,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    return new nodejs.NodejsFunction(this, `${name}Function`, {
      functionName,
      runtime: RUNTIME,
      architecture: ARCHITECTURE,
      handler: 'handler',
      entry: path.join(__dirname, '../lambdas', entryFile),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      logGroup,
      ...props,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: EXTERNAL_MODULES,
        ...props.bundling,
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        ...props.environment,
      },
    });
  }
}
