# 🔧 Практичний гайд з покращень

## 📋 Зміст

1. [Безпека](#безпека)
2. [Валідація та обробка помилок](#валідація-та-обробка-помилок)
3. [Оптимізація продуктивності](#оптимізація-продуктивності)
4. [Моніторинг та логування](#моніторинг-та-логування)
5. [Тестування](#тестування)
6. [CI/CD](#cicd)
7. [Нові функції](#нові-функції)

---

## 🔐 Безпека

### 1. Додати Cognito Authentication

**Файл:** `lib/image-processing-stack.ts`

```typescript
// Додати після imports
import * as cognito from 'aws-cdk-lib/aws-cognito';

// Додати в stack
const userPool = new cognito.UserPool(stack, 'ImageProcessingUserPool', {
  userPoolName: 'ImageProcessingUsers',
  selfSignUpEnabled: true,
  signInAliases: { email: true },
  autoVerify: { email: true },
  passwordPolicy: {
    minLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireDigits: true,
    requireSymbols: true,
  },
  accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

const userPoolClient = userPool.addClient('WebClient', {
  authFlows: {
    userPassword: true,
    userSrp: true,
  },
  oAuth: {
    flows: { authorizationCodeGrant: true },
    scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
  },
});

// Додати authorizer до API Gateway
const authorizer = new apigatewayv2.HttpUserPoolAuthorizer(
  'CognitoAuthorizer',
  userPool,
  {
    userPoolClients: [userPoolClient],
    identitySource: ['$request.header.Authorization'],
  }
);

// Оновити routes з authorizer
httpApi.addRoutes({
  path: '/upload',
  methods: [apigatewayv2.HttpMethod.POST],
  integration: lambda1Integration,
  authorizer: authorizer,
});

httpApi.addRoutes({
  path: '/status',
  methods: [apigatewayv2.HttpMethod.GET],
  integration: lambda4Integration,
  authorizer: authorizer,
});

// Outputs
new cdk.CfnOutput(stack, 'UserPoolId', {
  value: userPool.userPoolId,
  description: 'Cognito User Pool ID',
});

new cdk.CfnOutput(stack, 'UserPoolClientId', {
  value: userPoolClient.userPoolClientId,
  description: 'Cognito User Pool Client ID',
});
```

### 2. Обмежити CORS

**Файл:** `lib/image-processing-stack.ts`

```typescript
// Замість allowOrigins: ['*']
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'https://yourdomain.com',
];

const httpApi = new apigatewayv2.HttpApi(stack, 'ImageProcessingApi', {
  apiName: 'ImageProcessingApi',
  description: 'HTTP API for Image Processing Pipeline',
  corsPreflight: {
    allowOrigins: allowedOrigins,
    allowMethods: [
      apigatewayv2.CorsHttpMethod.GET,
      apigatewayv2.CorsHttpMethod.POST,
      apigatewayv2.CorsHttpMethod.OPTIONS,
    ],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: cdk.Duration.hours(1),
  },
});
```

### 3. Додати WAF

**Файл:** `lib/image-processing-stack.ts`

```typescript
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

const webAcl = new wafv2.CfnWebACL(stack, 'ApiGatewayWAF', {
  defaultAction: { allow: {} },
  scope: 'REGIONAL',
  visibilityConfig: {
    cloudWatchMetricsEnabled: true,
    metricName: 'ImageProcessingWAF',
    sampledRequestsEnabled: true,
  },
  rules: [
    {
      name: 'RateLimitRule',
      priority: 1,
      statement: {
        rateBasedStatement: {
          limit: 100,
          aggregateKeyType: 'IP',
        },
      },
      action: { block: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'RateLimitRule',
        sampledRequestsEnabled: true,
      },
    },
    {
      name: 'AWSManagedRulesCommonRuleSet',
      priority: 2,
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      overrideAction: { none: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'AWSManagedRulesCommonRuleSet',
        sampledRequestsEnabled: true,
      },
    },
  ],
});

new wafv2.CfnWebACLAssociation(stack, 'WebACLAssociation', {
  resourceArn: httpApi.apiArn,
  webAclArn: webAcl.attrArn,
});
```

---

## ✅ Валідація та обробка помилок

### 1. Валідація в get-upload-url.ts

**Файл:** `lambdas/get-upload-url.ts`

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.UPLOAD_BUCKET_NAME!;
const URL_EXPIRATION = 300;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface UploadRequest {
  contentType?: string;
  fileSize?: number;
  fileName?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body: UploadRequest = event.body ? JSON.parse(event.body) : {};
    
    // Валідація Content-Type
    if (body.contentType && !ALLOWED_CONTENT_TYPES.includes(body.contentType)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Invalid content type',
          message: `Allowed types: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
        }),
      };
    }

    // Валідація розміру файлу
    if (body.fileSize && body.fileSize > MAX_FILE_SIZE) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'File too large',
          message: `Maximum file size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        }),
      };
    }

    const imageId = randomUUID();
    const key = `uploads/${imageId}`;
    const contentType = body.contentType || 'image/jpeg';

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
      ContentLengthRange: [0, MAX_FILE_SIZE],
      Metadata: {
        originalFileName: body.fileName || 'unknown',
        uploadedAt: new Date().toISOString(),
      },
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: URL_EXPIRATION,
    });

    console.log(JSON.stringify({
      level: 'info',
      message: 'Upload URL generated',
      imageId,
      contentType,
      fileSize: body.fileSize,
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        uploadUrl,
        imageId,
        key,
        expiresIn: URL_EXPIRATION,
        maxFileSize: MAX_FILE_SIZE,
      }),
    };
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Error generating upload URL',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }));

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to generate upload URL',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
```

### 2. Покращена обробка помилок в process-upload.ts

**Файл:** `lambdas/process-upload.ts`

```typescript
import { S3Event } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({});
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const QUEUE_URL = process.env.QUEUE_URL!;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const handler = async (event: S3Event): Promise<void> => {
  console.log(JSON.stringify({
    level: 'info',
    message: 'S3 Event received',
    recordCount: event.Records.length,
  }));

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const size = record.s3.object.size;
    const imageId = key.split('/').pop()!;

    try {
      // Валідація розміру
      if (size > MAX_FILE_SIZE) {
        throw new Error(`File size ${size} exceeds maximum ${MAX_FILE_SIZE}`);
      }

      // Отримати metadata та ContentType
      const headObject = await s3Client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      );

      const contentType = headObject.ContentType || 'unknown';

      // Валідація Content-Type
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        throw new Error(`Invalid content type: ${contentType}`);
      }

      // Створити запис в DynamoDB
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            imageId,
            originalKey: key,
            bucket,
            size,
            contentType,
            status: 'pending',
            uploadedAt: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 днів
          },
        })
      );

      console.log(JSON.stringify({
        level: 'info',
        message: 'DynamoDB record created',
        imageId,
        size,
        contentType,
      }));

      // Відправити в SQS з deduplication
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({
            imageId,
            bucket,
            key,
            contentType,
            size,
          }),
          MessageDeduplicationId: imageId,
          MessageGroupId: 'image-processing',
        })
      );

      console.log(JSON.stringify({
        level: 'info',
        message: 'Message sent to SQS',
        imageId,
      }));

    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Error processing image',
        imageId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      }));

      // Оновити DynamoDB з помилкою
      try {
        await docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              imageId,
              originalKey: key,
              bucket,
              size,
              status: 'error',
              errorMessage: error instanceof Error ? error.message : 'Unknown error',
              uploadedAt: new Date().toISOString(),
              ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 днів для errors
            },
          })
        );
      } catch (dbError) {
        console.error(JSON.stringify({
          level: 'error',
          message: 'Failed to update DynamoDB with error status',
          imageId,
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
        }));
      }

      throw error;
    }
  }
};
```

### 3. Retry logic в resize-image.ts

**Файл:** `lambdas/resize-image.ts`

```typescript
import { SQSEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import sharp from 'sharp';
import { Readable } from 'stream';

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;
const PROCESSED_BUCKET_NAME = process.env.PROCESSED_BUCKET_NAME!;
const TARGET_SIZE = parseInt(process.env.TARGET_SIZE || '400');
const JPEG_QUALITY = parseInt(process.env.JPEG_QUALITY || '85');
const MAX_RETRIES = 3;

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Retrying operation',
      retriesLeft: retries,
      delay,
    }));

    await new Promise(resolve => setTimeout(resolve, delay));
    return retryWithBackoff(fn, retries - 1, delay * 2);
  }
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log(JSON.stringify({
    level: 'info',
    message: 'SQS Event received',
    recordCount: event.Records.length,
  }));

  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    const { imageId, bucket, key, contentType, size } = message;
    const startTime = Date.now();

    try {
      console.log(JSON.stringify({
        level: 'info',
        message: 'Processing image',
        imageId,
        size,
        contentType,
      }));

      // Завантажити з S3 з retry
      const getObjectResponse = await retryWithBackoff(() =>
        s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      );

      if (!getObjectResponse.Body) {
        throw new Error('No body in S3 response');
      }

      const imageBuffer = await streamToBuffer(getObjectResponse.Body as Readable);

      // Обробка зображення з Sharp
      const metadata = await sharp(imageBuffer).metadata();
      
      console.log(JSON.stringify({
        level: 'info',
        message: 'Image metadata',
        imageId,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      }));

      let sharpInstance = sharp(imageBuffer)
        .resize(TARGET_SIZE, TARGET_SIZE, {
          fit: 'cover',
          position: 'center',
        })
        .rotate(); // Auto-rotate based on EXIF

      // Оптимізація по формату
      if (contentType === 'image/jpeg') {
        sharpInstance = sharpInstance.jpeg({ quality: JPEG_QUALITY, progressive: true });
      } else if (contentType === 'image/png') {
        sharpInstance = sharpInstance.png({ compressionLevel: 9 });
      } else if (contentType === 'image/webp') {
        sharpInstance = sharpInstance.webp({ quality: JPEG_QUALITY });
      }

      const resizedImageBuffer = await sharpInstance.toBuffer();

      const processedKey = `processed/${imageId}`;

      // Завантажити в S3 з retry
      await retryWithBackoff(() =>
        s3Client.send(
          new PutObjectCommand({
            Bucket: PROCESSED_BUCKET_NAME,
            Key: processedKey,
            Body: resizedImageBuffer,
            ContentType: contentType,
            CacheControl: 'max-age=31536000', // 1 рік
            Metadata: {
              originalSize: size.toString(),
              processedSize: resizedImageBuffer.length.toString(),
              targetSize: TARGET_SIZE.toString(),
            },
          })
        )
      );

      const processingTime = Date.now() - startTime;

      console.log(JSON.stringify({
        level: 'info',
        message: 'Image resized and uploaded',
        imageId,
        processedKey,
        originalSize: size,
        processedSize: resizedImageBuffer.length,
        compressionRatio: ((1 - resizedImageBuffer.length / size) * 100).toFixed(2) + '%',
        processingTime: processingTime + 'ms',
      }));

      // Оновити DynamoDB з retry
      await retryWithBackoff(() =>
        docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { imageId },
            UpdateExpression: 
              'SET #status = :status, processedKey = :processedKey, processedAt = :processedAt, ' +
              'processedSize = :processedSize, processingTime = :processingTime',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'ok',
              ':processedKey': processedKey,
              ':processedAt': new Date().toISOString(),
              ':processedSize': resizedImageBuffer.length,
              ':processingTime': processingTime,
            },
          })
        )
      );

      console.log(JSON.stringify({
        level: 'info',
        message: 'DynamoDB updated',
        imageId,
      }));

    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Error processing image',
        imageId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      }));

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { imageId },
            UpdateExpression: 'SET #status = :status, errorMessage = :errorMessage, errorAt = :errorAt',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'error',
              ':errorMessage': error instanceof Error ? error.message : 'Unknown error',
              ':errorAt': new Date().toISOString(),
            },
          })
        );
      } catch (updateError) {
        console.error(JSON.stringify({
          level: 'error',
          message: 'Error updating DynamoDB with error status',
          imageId,
          error: updateError instanceof Error ? updateError.message : 'Unknown error',
        }));
      }

      throw error;
    }
  }
};
```

---

## ⚡ Оптимізація продуктивності

### 1. Додати DLQ та CloudWatch Alarms

**Файл:** `lib/image-processing-stack.ts`

```typescript
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

// SNS Topic для алертів
const alertTopic = new sns.Topic(stack, 'AlertTopic', {
  displayName: 'Image Processing Alerts',
});

// Підписка на email (опціонально)
if (process.env.ALERT_EMAIL) {
  alertTopic.addSubscription(
    new subscriptions.EmailSubscription(process.env.ALERT_EMAIL)
  );
}

// Dead Letter Queue
const dlq = new sqs.Queue(stack, 'ImageProcessingDLQ', {
  queueName: 'ImageProcessingDLQ',
  retentionPeriod: cdk.Duration.days(14),
});

// Main Queue з DLQ
const queue = new sqs.Queue(stack, 'ImageProcessingQueue', {
  queueName: 'ImageProcessingQueue',
  visibilityTimeout: cdk.Duration.seconds(300),
  retentionPeriod: cdk.Duration.days(4),
  deadLetterQueue: {
    queue: dlq,
    maxReceiveCount: 3,
  },
});

// CloudWatch Alarm для DLQ
const dlqAlarm = new cloudwatch.Alarm(stack, 'DLQAlarm', {
  metric: dlq.metricApproximateNumberOfMessagesVisible(),
  threshold: 1,
  evaluationPeriods: 1,
  alarmDescription: 'Alert when messages appear in DLQ',
  alarmName: 'ImageProcessing-DLQ-Messages',
});

dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

// Lambda Error Rate Alarm
const lambda3ErrorAlarm = new cloudwatch.Alarm(stack, 'Lambda3ErrorAlarm', {
  metric: lambda3.metricErrors({
    statistic: 'sum',
    period: cdk.Duration.minutes(5),
  }),
  threshold: 5,
  evaluationPeriods: 1,
  alarmDescription: 'Alert when Lambda3 error rate is high',
  alarmName: 'ImageProcessing-Lambda3-Errors',
});

lambda3ErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

// API Gateway 5xx Alarm
const api5xxAlarm = new cloudwatch.Alarm(stack, 'Api5xxAlarm', {
  metric: new cloudwatch.Metric({
    namespace: 'AWS/ApiGateway',
    metricName: '5XXError',
    dimensionsMap: {
      ApiId: httpApi.apiId,
    },
    statistic: 'sum',
    period: cdk.Duration.minutes(5),
  }),
  threshold: 10,
  evaluationPeriods: 1,
  alarmDescription: 'Alert when API Gateway 5xx errors are high',
  alarmName: 'ImageProcessing-API-5xx',
});

api5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));
```

### 2. Додати S3 Lifecycle Rules

**Файл:** `lib/image-processing-stack.ts`

```typescript
// Upload Bucket з lifecycle
const uploadBucket = new s3.Bucket(stack, 'UploadBucket', {
  bucketName: `image-upload-${stack.account}-${stack.region}`,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  lifecycleRules: [
    {
      id: 'DeleteOldUploads',
      enabled: true,
      expiration: cdk.Duration.days(7),
      prefix: 'uploads/',
    },
  ],
  cors: [
    {
      allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      maxAge: 3000,
    },
  ],
});

// Processed Bucket з lifecycle та intelligent tiering
const processedBucket = new s3.Bucket(stack, 'ProcessedBucket', {
  bucketName: `image-processed-${stack.account}-${stack.region}`,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  lifecycleRules: [
    {
      id: 'IntelligentTiering',
      enabled: true,
      transitions: [
        {
          storageClass: s3.StorageClass.INTELLIGENT_TIERING,
          transitionAfter: cdk.Duration.days(0),
        },
      ],
    },
    {
      id: 'DeleteOldProcessed',
      enabled: true,
      expiration: cdk.Duration.days(90),
    },
  ],
});
```

### 3. Додати DynamoDB TTL

**Файл:** `lib/image-processing-stack.ts`

```typescript
const table = new dynamodb.Table(stack, 'ImageTable', {
  tableName: 'ImageProcessingTable',
  partitionKey: { name: 'imageId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  timeToLiveAttribute: 'ttl',
  pointInTimeRecovery: true, // Backup
});

// GSI для запитів по статусу
table.addGlobalSecondaryIndex({
  indexName: 'StatusIndex',
  partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'uploadedAt', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

### 4. Додати X-Ray Tracing

**Файл:** `lib/image-processing-stack.ts`

```typescript
// Додати до всіх Lambda
const lambda1 = new nodejs.NodejsFunction(stack, 'GetUploadUrlFunction', {
  // ... existing config
  tracing: lambda.Tracing.ACTIVE,
});

const lambda2 = new nodejs.NodejsFunction(stack, 'ProcessUploadFunction', {
  // ... existing config
  tracing: lambda.Tracing.ACTIVE,
});

const lambda3 = new nodejs.NodejsFunction(stack, 'ResizeImageFunction', {
  // ... existing config
  tracing: lambda.Tracing.ACTIVE,
});

const lambda4 = new nodejs.NodejsFunction(stack, 'GetStatusFunction', {
  // ... existing config
  tracing: lambda.Tracing.ACTIVE,
});
```

---

## 📊 Моніторинг та логування

### CloudWatch Dashboard

**Файл:** `lib/monitoring-stack.ts` (новий файл)

```typescript
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  lambda1: cdk.aws_lambda.IFunction;
  lambda2: cdk.aws_lambda.IFunction;
  lambda3: cdk.aws_lambda.IFunction;
  lambda4: cdk.aws_lambda.IFunction;
  queue: cdk.aws_sqs.IQueue;
  dlq: cdk.aws_sqs.IQueue;
  table: cdk.aws_dynamodb.ITable;
  httpApi: cdk.aws_apigatewayv2.IHttpApi;
}

export function createMonitoringDashboard(
  scope: Construct,
  id: string,
  props: MonitoringStackProps
): cloudwatch.Dashboard {
  const dashboard = new cloudwatch.Dashboard(scope, id, {
    dashboardName: 'ImageProcessingPipeline',
  });

  // Lambda Metrics
  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Lambda Invocations',
      left: [
        props.lambda1.metricInvocations(),
        props.lambda2.metricInvocations(),
        props.lambda3.metricInvocations(),
        props.lambda4.metricInvocations(),
      ],
    }),
    new cloudwatch.GraphWidget({
      title: 'Lambda Errors',
      left: [
        props.lambda1.metricErrors(),
        props.lambda2.metricErrors(),
        props.lambda3.metricErrors(),
        props.lambda4.metricErrors(),
      ],
    })
  );

  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Lambda Duration',
      left: [
        props.lambda1.metricDuration(),
        props.lambda2.metricDuration(),
        props.lambda3.metricDuration(),
        props.lambda4.metricDuration(),
      ],
    }),
    new cloudwatch.GraphWidget({
      title: 'Lambda Throttles',
      left: [
        props.lambda1.metricThrottles(),
        props.lambda2.metricThrottles(),
        props.lambda3.metricThrottles(),
        props.lambda4.metricThrottles(),
      ],
    })
  );

  // SQS Metrics
  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'SQS Queue Depth',
      left: [
        props.queue.metricApproximateNumberOfMessagesVisible(),
        props.dlq.metricApproximateNumberOfMessagesVisible(),
      ],
    }),
    new cloudwatch.GraphWidget({
      title: 'SQS Messages Sent/Received',
      left: [
        props.queue.metricNumberOfMessagesSent(),
        props.queue.metricNumberOfMessagesReceived(),
      ],
    })
  );

  // DynamoDB Metrics
  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'DynamoDB Read/Write Capacity',
      left: [
        props.table.metricConsumedReadCapacityUnits(),
        props.table.metricConsumedWriteCapacityUnits(),
      ],
    }),
    new cloudwatch.GraphWidget({
      title: 'DynamoDB Throttles',
      left: [
        props.table.metricUserErrors(),
        props.table.metricSystemErrorsForOperations(),
      ],
    })
  );

  // API Gateway Metrics
  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'API Gateway Requests',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Count',
          dimensionsMap: { ApiId: props.httpApi.apiId },
          statistic: 'sum',
        }),
      ],
    }),
    new cloudwatch.GraphWidget({
      title: 'API Gateway Errors',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '4XXError',
          dimensionsMap: { ApiId: props.httpApi.apiId },
          statistic: 'sum',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '5XXError',
          dimensionsMap: { ApiId: props.httpApi.apiId },
          statistic: 'sum',
        }),
      ],
    })
  );

  return dashboard;
}
```

---

## 🧪 Тестування

### Unit Tests

**Файл:** `lambdas/__tests__/get-upload-url.test.ts`

```typescript
import { handler } from '../get-upload-url';
import { APIGatewayProxyEvent } from 'aws-lambda';

describe('GetUploadUrl Lambda', () => {
  const mockEvent: Partial<APIGatewayProxyEvent> = {
    body: JSON.stringify({
      contentType: 'image/jpeg',
      fileSize: 1024000,
      fileName: 'test.jpg',
    }),
  };

  it('should generate upload URL successfully', async () => {
    const result = await handler(mockEvent as APIGatewayProxyEvent);
    
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('uploadUrl');
    expect(body).toHaveProperty('imageId');
    expect(body).toHaveProperty('key');
    expect(body.key).toMatch(/^uploads\//);
  });

  it('should reject invalid content type', async () => {
    const invalidEvent = {
      ...mockEvent,
      body: JSON.stringify({
        contentType: 'application/pdf',
      }),
    };

    const result = await handler(invalidEvent as APIGatewayProxyEvent);
    
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Invalid content type');
  });

  it('should reject file too large', async () => {
    const largeFileEvent = {
      ...mockEvent,
      body: JSON.stringify({
        contentType: 'image/jpeg',
        fileSize: 20 * 1024 * 1024, // 20MB
      }),
    };

    const result = await handler(largeFileEvent as APIGatewayProxyEvent);
    
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('File too large');
  });
});
```

**Файл:** `package.json` (додати scripts)

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "jest": "^29.5.0",
    "ts-jest": "^29.1.0"
  }
}
```

**Файл:** `jest.config.js`

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/lambdas'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'lambdas/**/*.ts',
    '!lambdas/**/*.test.ts',
    '!lambdas/**/__tests__/**',
  ],
};
```

---

## 🚀 CI/CD

### GitHub Actions

**Файл:** `.github/workflows/deploy.yml`

```yaml
name: Deploy Image Processing Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  AWS_REGION: eu-north-1
  NODE_VERSION: '20'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run tests
        run: npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  deploy-dev:
    needs: test
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    environment: development
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: CDK Diff
        run: npm run diff
      
      - name: CDK Deploy
        run: npm run deploy -- --require-approval never

  deploy-prod:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID_PROD }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY_PROD }}
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: CDK Diff
        run: npm run diff
      
      - name: CDK Deploy
        run: npm run deploy -- --require-approval never
      
      - name: Run smoke tests
        run: npm run test:e2e
```

---

## 🎨 Нові функції

### 1. Підтримка кількох розмірів

**Файл:** `lambdas/resize-image.ts`

```typescript
const SIZES = [
  { name: 'thumbnail', size: 100 },
  { name: 'small', size: 400 },
  { name: 'medium', size: 800 },
  { name: 'large', size: 1200 },
];

// В handler
const resizePromises = SIZES.map(async ({ name, size }) => {
  const resizedBuffer = await sharp(imageBuffer)
    .resize(size, size, { fit: 'cover', position: 'center' })
    .jpeg({ quality: JPEG_QUALITY, progressive: true })
    .toBuffer();

  const key = `processed/${imageId}-${name}`;
  
  await s3Client.send(
    new PutObjectCommand({
      Bucket: PROCESSED_BUCKET_NAME,
      Key: key,
      Body: resizedBuffer,
      ContentType: contentType,
    })
  );

  return { name, key, size: resizedBuffer.length };
});

const results = await Promise.all(resizePromises);
```

### 2. WebSocket для real-time updates

**Файл:** `lib/websocket-stack.ts`

```typescript
import * as apigatewayv2 from '@aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from '@aws-cdk-lib/aws-apigatewayv2-integrations';

const webSocketApi = new apigatewayv2.WebSocketApi(stack, 'ImageProcessingWebSocket', {
  apiName: 'ImageProcessingWebSocket',
  connectRouteOptions: {
    integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
      'ConnectIntegration',
      connectLambda
    ),
  },
  disconnectRouteOptions: {
    integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
      'DisconnectIntegration',
      disconnectLambda
    ),
  },
});

const stage = new apigatewayv2.WebSocketStage(stack, 'ProductionStage', {
  webSocketApi,
  stageName: 'production',
  autoDeploy: true,
});
```

---

## 📝 Висновок

Цей гайд містить конкретні приклади коду для покращення проекту. Рекомендую імплементувати зміни в такому порядку:

1. **Безпека** (критично)
2. **Валідація та обробка помилок** (критично)
3. **Моніторинг** (важливо)
4. **Тестування** (важливо)
5. **Оптимізація** (середньо)
6. **Нові функції** (опціонально)

Кожна зміна має бути протестована окремо перед deployment в production.
