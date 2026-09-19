import { S3Event } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ImageRecord, RECORD_TTL_DAYS, SQSMessage } from '../types/image-record';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const QUEUE_URL = process.env.QUEUE_URL!;

/**
 * S3 ObjectCreated handler — registers the upload and enqueues it for resizing.
 *
 * The DynamoDB write happens before the SQS send, so a consumer can never see
 * a message for an image that has no record. If the send fails the whole
 * invocation fails and S3 retries the notification; the PutItem is idempotent.
 */
export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const size = record.s3.object.size;
    const imageId = key.split('/').pop()!;

    const item: ImageRecord = {
      imageId,
      originalKey: key,
      bucket,
      size,
      status: 'pending',
      uploadedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + RECORD_TTL_DAYS * 24 * 60 * 60,
    };

    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    console.log(`Registered upload ${imageId} (${size} bytes)`);

    const message: SQSMessage = { imageId, bucket, key };
    await sqsClient.send(new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: JSON.stringify(message) }));
    console.log(`Enqueued ${imageId} for processing`);
  }
};
