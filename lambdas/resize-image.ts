import { SQSEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import sharp from 'sharp';
import { isSQSMessage } from '../types/image-record';

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;
const PROCESSED_BUCKET_NAME = process.env.PROCESSED_BUCKET_NAME!;
const TARGET_SIZE = 400;

/** Refuse to decode anything larger than ~25 MP (≈5000×5000). Guards against decompression bombs. */
const MAX_INPUT_PIXELS = 25_000_000;

/**
 * Raised for inputs that will never succeed no matter how many times we retry
 * (corrupt file, unsupported format, decompression bomb). These are recorded
 * as `error` and acknowledged so they do not churn through the queue and DLQ.
 */
class UnprocessableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnprocessableImageError';
  }
}

async function resize(input: Uint8Array): Promise<Buffer> {
  try {
    return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // honour EXIF orientation before cropping
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover', position: 'center' })
      .toBuffer();
  } catch (error) {
    throw new UnprocessableImageError(error instanceof Error ? error.message : 'Unsupported image');
  }
}

async function markError(imageId: string, errorMessage: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { imageId },
      UpdateExpression: 'SET #status = :status, errorMessage = :errorMessage',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'error', ':errorMessage': errorMessage },
    })
  );
}

async function markProcessed(imageId: string, processedKey: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { imageId },
      UpdateExpression: 'SET #status = :status, processedKey = :processedKey, processedAt = :processedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'ok',
        ':processedKey': processedKey,
        ':processedAt': new Date().toISOString(),
      },
    })
  );
}

/**
 * SQS consumer — downloads the original, resizes it to 400×400 and stores the result.
 *
 * Error handling is split in two:
 *  - Permanent failures (bad image) → record `error`, swallow, message is deleted.
 *  - Transient failures (S3/DynamoDB) → record `error` best-effort, rethrow so SQS
 *    redelivers; after `maxReceiveCount` attempts the message lands in the DLQ.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(record.body);
    } catch {
      // Nothing to correlate with in DynamoDB — log and drop, retrying cannot help.
      console.error(`Dropping message ${record.messageId}: body is not valid JSON`);
      continue;
    }
    if (!isSQSMessage(parsed)) {
      console.error(`Dropping message ${record.messageId}: unexpected payload shape`);
      continue;
    }
    const { imageId, bucket, key } = parsed;

    try {
      console.log(`Processing image ${imageId}`);

      const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!object.Body) {
        throw new Error('Empty body in S3 response');
      }
      const original = await object.Body.transformToByteArray();
      const resized = await resize(original);
      const processedKey = `processed/${imageId}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: PROCESSED_BUCKET_NAME,
          Key: processedKey,
          Body: resized,
          ContentType: object.ContentType ?? 'image/jpeg',
        })
      );
      await markProcessed(imageId, processedKey);
      console.log(`Image ${imageId} processed → ${processedKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error processing image ${imageId}: ${message}`);

      try {
        await markError(imageId, message);
      } catch (updateError) {
        console.error(`Failed to record error status for ${imageId}:`, updateError);
      }

      if (error instanceof UnprocessableImageError) {
        continue;
      }
      throw error;
    }
  }
};
