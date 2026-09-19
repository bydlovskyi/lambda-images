import { describe, it, expect, beforeEach } from 'vitest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../lambdas/process-upload';
import { RECORD_TTL_DAYS } from '../types/image-record';
import { s3Event, VALID_UUID } from './helpers';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

describe('process-upload', () => {
  beforeEach(() => {
    ddbMock.reset();
    sqsMock.reset();
    ddbMock.on(PutCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm1' });
  });

  it('creates a pending record with a TTL and enqueues the image', async () => {
    const before = Math.floor(Date.now() / 1000);
    await handler(s3Event('image-upload-test', `uploads/${VALID_UUID}`, 4096));

    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.TableName).toBe('ImageProcessingTable');
    expect(put.Item).toMatchObject({
      imageId: VALID_UUID,
      originalKey: `uploads/${VALID_UUID}`,
      bucket: 'image-upload-test',
      size: 4096,
      status: 'pending',
    });
    expect(put.Item!.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // TTL is ~7 days out, in epoch seconds (not milliseconds).
    expect(put.Item!.expiresAt).toBeGreaterThanOrEqual(before + RECORD_TTL_DAYS * 86400);
    expect(put.Item!.expiresAt).toBeLessThan(before + RECORD_TTL_DAYS * 86400 + 60);

    const send = sqsMock.commandCalls(SendMessageCommand)[0].args[0].input;
    expect(send.QueueUrl).toBe(process.env.QUEUE_URL);
    expect(JSON.parse(send.MessageBody!)).toEqual({
      imageId: VALID_UUID,
      bucket: 'image-upload-test',
      key: `uploads/${VALID_UUID}`,
    });
  });

  it('URL-decodes the object key from the S3 notification', async () => {
    await handler(s3Event('image-upload-test', 'uploads/abc%2Bdef+ghi', 1));
    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.Item!.originalKey).toBe('uploads/abc+def ghi');
    expect(put.Item!.imageId).toBe('abc+def ghi');
  });

  it('writes the record before publishing, and does not publish if the write fails', async () => {
    ddbMock.on(PutCommand).rejects(new Error('ProvisionedThroughputExceeded'));
    await expect(handler(s3Event('image-upload-test', `uploads/${VALID_UUID}`, 1))).rejects.toThrow(
      'ProvisionedThroughputExceeded'
    );
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('propagates SQS failures so S3 retries the notification', async () => {
    sqsMock.on(SendMessageCommand).rejects(new Error('SQS unavailable'));
    await expect(handler(s3Event('image-upload-test', `uploads/${VALID_UUID}`, 1))).rejects.toThrow('SQS unavailable');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});
