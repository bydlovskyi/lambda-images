import { S3Event } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const QUEUE_URL = process.env.QUEUE_URL!;

export const handler = async (event: S3Event): Promise<void> => {
  console.log('S3 Event received:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const size = record.s3.object.size;

    const imageId = key.split('/').pop()!;

    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            imageId,
            originalKey: key,
            bucket,
            size,
            status: 'pending',
            uploadedAt: new Date().toISOString(),
            expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
          },
        })
      );

      console.log(`DynamoDB record created for imageId: ${imageId}`);

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({
            imageId,
            bucket,
            key,
          }),
        })
      );

      console.log(`Message sent to SQS for imageId: ${imageId}`);
    } catch (error) {
      console.error(`Error processing image ${imageId}:`, error);
      throw error;
    }
  }
};
