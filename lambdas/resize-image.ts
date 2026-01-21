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
const TARGET_SIZE = 400;

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('SQS Event received:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    const { imageId, bucket, key } = message;

    try {
      console.log(`Processing image: ${imageId}`);

      const getObjectResponse = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );

      if (!getObjectResponse.Body) {
        throw new Error('No body in S3 response');
      }

      const imageBuffer = await streamToBuffer(getObjectResponse.Body as Readable);

      const resizedImageBuffer = await sharp(imageBuffer)
        .resize(TARGET_SIZE, TARGET_SIZE, {
          fit: 'cover',
          position: 'center',
        })
        .toBuffer();

      const processedKey = `processed/${imageId}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: PROCESSED_BUCKET_NAME,
          Key: processedKey,
          Body: resizedImageBuffer,
          ContentType: getObjectResponse.ContentType || 'image/jpeg',
        })
      );

      console.log(`Resized image uploaded to: ${processedKey}`);

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { imageId },
          UpdateExpression: 'SET #status = :status, processedKey = :processedKey, processedAt = :processedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'ok',
            ':processedKey': processedKey,
            ':processedAt': new Date().toISOString(),
          },
        })
      );

      console.log(`DynamoDB updated for imageId: ${imageId}`);
    } catch (error) {
      console.error(`Error processing image ${imageId}:`, error);

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { imageId },
            UpdateExpression: 'SET #status = :status, errorMessage = :errorMessage',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'error',
              ':errorMessage': error instanceof Error ? error.message : 'Unknown error',
            },
          })
        );
      } catch (updateError) {
        console.error('Error updating DynamoDB with error status:', updateError);
      }

      throw error;
    }
  }
};
