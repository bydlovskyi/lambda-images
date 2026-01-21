import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';

export function createImageProcessingStack(scope: Construct, id: string, props?: cdk.StackProps): cdk.Stack {
  const stack = new cdk.Stack(scope, id, props);

  const uploadBucket = new s3.Bucket(stack, 'UploadBucket', {
    bucketName: `image-upload-${stack.account}-${stack.region}`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    cors: [
      {
        allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
        maxAge: 3000,
      },
    ],
  });

  const processedBucket = new s3.Bucket(stack, 'ProcessedBucket', {
    bucketName: `image-processed-${stack.account}-${stack.region}`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  });

  const table = new dynamodb.Table(stack, 'ImageTable', {
    tableName: 'ImageProcessingTable',
    partitionKey: { name: 'imageId', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    timeToLiveAttribute: 'expiresAt'
  });

  const queue = new sqs.Queue(stack, 'ImageProcessingQueue', {
    queueName: 'ImageProcessingQueue',
    visibilityTimeout: cdk.Duration.seconds(300),
    retentionPeriod: cdk.Duration.days(4),
  });

  const lambda1 = new nodejs.NodejsFunction(stack, 'GetUploadUrlFunction', {
    functionName: 'ImageProcessing-GetUploadUrl',
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'handler',
    entry: path.join(__dirname, '../lambdas/get-upload-url.ts'),
    environment: {
      UPLOAD_BUCKET_NAME: uploadBucket.bucketName,
    },
    timeout: cdk.Duration.seconds(30),
  });

  uploadBucket.grantPut(lambda1);

  const lambda2 = new nodejs.NodejsFunction(stack, 'ProcessUploadFunction', {
    functionName: 'ImageProcessing-ProcessUpload',
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'handler',
    entry: path.join(__dirname, '../lambdas/process-upload.ts'),
    environment: {
      TABLE_NAME: table.tableName,
      QUEUE_URL: queue.queueUrl,
    },
    timeout: cdk.Duration.seconds(30),
  });

  lambda2.addEventSource(
    new lambdaEventSources.S3EventSource(uploadBucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{ prefix: 'uploads/' }],
    })
  );

  table.grantWriteData(lambda2);
  queue.grantSendMessages(lambda2);
  uploadBucket.grantRead(lambda2);

  const lambda3 = new nodejs.NodejsFunction(stack, 'ResizeImageFunction', {
    functionName: 'ImageProcessing-ResizeImage',
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'handler',
    entry: path.join(__dirname, '../lambdas/resize-image.ts'),
    environment: {
      TABLE_NAME: table.tableName,
      PROCESSED_BUCKET_NAME: processedBucket.bucketName,
    },
    timeout: cdk.Duration.seconds(300),
    memorySize: 1024,
    bundling: {
      nodeModules: ['sharp'],
    },
  });

  lambda3.addEventSource(
    new lambdaEventSources.SqsEventSource(queue, {
      batchSize: 1,
    })
  );

  uploadBucket.grantRead(lambda3);
  processedBucket.grantPut(lambda3);
  table.grantReadWriteData(lambda3);

  const lambda4 = new nodejs.NodejsFunction(stack, 'GetStatusFunction', {
    functionName: 'ImageProcessing-GetStatus',
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'handler',
    entry: path.join(__dirname, '../lambdas/get-status.ts'),
    environment: {
      TABLE_NAME: table.tableName,
      PROCESSED_BUCKET_NAME: processedBucket.bucketName,
    },
    timeout: cdk.Duration.seconds(30),
  });

  table.grantReadData(lambda4);
  processedBucket.grantRead(lambda4);

  const httpApi = new apigatewayv2.HttpApi(stack, 'ImageProcessingApi', {
    apiName: 'ImageProcessingApi',
    description: 'HTTP API for Image Processing Pipeline',
    corsPreflight: {
      allowOrigins: ['*'],
      allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.POST, apigatewayv2.CorsHttpMethod.OPTIONS],
      allowHeaders: ['*'],
    },
  });

  const lambda1Integration = new apigatewayv2Integrations.HttpLambdaIntegration('Lambda1Integration', lambda1);
  httpApi.addRoutes({
    path: '/upload',
    methods: [apigatewayv2.HttpMethod.POST],
    integration: lambda1Integration,
  });

  const lambda4Integration = new apigatewayv2Integrations.HttpLambdaIntegration('Lambda4Integration', lambda4);
  httpApi.addRoutes({
    path: '/status',
    methods: [apigatewayv2.HttpMethod.GET],
    integration: lambda4Integration,
  });

  new cdk.CfnOutput(stack, 'UploadBucketName', {
    value: uploadBucket.bucketName,
    description: '1. Upload S3 Bucket Name',
  });

  new cdk.CfnOutput(stack, 'ProcessedBucketName', {
    value: processedBucket.bucketName,
    description: '2. Processed S3 Bucket Name',
  });

  new cdk.CfnOutput(stack, 'TableName', {
    value: table.tableName,
    description: '3. DynamoDB Table Name',
  });

  new cdk.CfnOutput(stack, 'QueueUrl', {
    value: queue.queueUrl,
    description: '4. SQS Queue URL',
  });

  new cdk.CfnOutput(stack, 'Lambda1FunctionName', {
    value: lambda1.functionName,
    description: '5. Lambda1 (Get Upload URL) Function Name',
  });

  new cdk.CfnOutput(stack, 'Lambda2FunctionName', {
    value: lambda2.functionName,
    description: '6. Lambda2 (Process Upload) Function Name',
  });

  new cdk.CfnOutput(stack, 'Lambda3FunctionName', {
    value: lambda3.functionName,
    description: '7. Lambda3 (Resize Image) Function Name',
  });

  new cdk.CfnOutput(stack, 'Lambda4FunctionName', {
    value: lambda4.functionName,
    description: '8. Lambda4 (Get Status) Function Name',
  });

  new cdk.CfnOutput(stack, 'ApiEndpoint', {
    value: httpApi.url!,
    description: '9. API Gateway HTTP API Endpoint',
  });

  new cdk.CfnOutput(stack, 'UploadEndpoint', {
    value: `${httpApi.url}upload`,
    description: '10. POST /upload - Get Upload URL',
  });

  new cdk.CfnOutput(stack, 'StatusEndpoint', {
    value: `${httpApi.url}status`,
    description: '11. GET /status - Get Image Status',
  });

  return stack;
}
