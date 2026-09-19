import { describe, it, expect, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { sdkStreamMixin } from '@smithy/util-stream';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import sharp from 'sharp';
import { handler } from '../lambdas/resize-image';
import { makeJpeg, sqsEvent, VALID_UUID } from './helpers';

const s3Mock = mockClient(S3Client);
const ddbMock = mockClient(DynamoDBDocumentClient);

const message = JSON.stringify({ imageId: VALID_UUID, bucket: 'image-upload-test', key: `uploads/${VALID_UUID}` });

function s3Body(buffer: Buffer) {
  return sdkStreamMixin(Readable.from([buffer]));
}

function statusUpdates(): Array<{ status: string; values: Record<string, unknown> }> {
  return ddbMock.commandCalls(UpdateCommand).map((call) => {
    const values = call.args[0].input.ExpressionAttributeValues!;
    return { status: values[':status'] as string, values };
  });
}

describe('resize-image', () => {
  beforeEach(() => {
    s3Mock.reset();
    ddbMock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
  });

  it('resizes a real JPEG to 400×400, stores it and marks the record ok', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: s3Body(await makeJpeg(800, 600)), ContentType: 'image/jpeg' });

    await handler(sqsEvent(message));

    const get = s3Mock.commandCalls(GetObjectCommand)[0].args[0].input;
    expect(get).toEqual({ Bucket: 'image-upload-test', Key: `uploads/${VALID_UUID}` });

    const put = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(put.Bucket).toBe('image-processed-test');
    expect(put.Key).toBe(`processed/${VALID_UUID}`);
    expect(put.ContentType).toBe('image/jpeg');

    const meta = await sharp(put.Body as Buffer).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(400);
    expect(meta.format).toBe('jpeg');

    const [update] = statusUpdates();
    expect(update.status).toBe('ok');
    expect(update.values[':processedKey']).toBe(`processed/${VALID_UUID}`);
    expect(update.values[':processedAt']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records an error and does NOT rethrow when the payload is not an image (permanent failure)', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: s3Body(Buffer.from('definitely not an image')), ContentType: 'text/plain' });

    await expect(handler(sqsEvent(message))).resolves.toBeUndefined();

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    const [update] = statusUpdates();
    expect(update.status).toBe('error');
    expect(update.values[':errorMessage']).toEqual(expect.any(String));
  });

  it('refuses decompression bombs via limitInputPixels', async () => {
    // 6000×6000 = 36 MP > 25 MP limit. A PNG of a flat colour compresses to a few KB.
    const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    s3Mock.on(GetObjectCommand).resolves({ Body: s3Body(bomb), ContentType: 'image/png' });

    await handler(sqsEvent(message));

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    const [update] = statusUpdates();
    expect(update.status).toBe('error');
    expect(update.values[':errorMessage']).toMatch(/pixel limit/i);
  });

  it('records an error AND rethrows on infrastructure failure so SQS retries / DLQs the message', async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error('NoSuchKey'));

    await expect(handler(sqsEvent(message))).rejects.toThrow('NoSuchKey');

    const [update] = statusUpdates();
    expect(update.status).toBe('error');
    expect(update.values[':errorMessage']).toBe('NoSuchKey');
  });

  it('still rethrows the original error when the status update itself fails', async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error('NoSuchKey'));
    ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB down'));

    await expect(handler(sqsEvent(message))).rejects.toThrow('NoSuchKey');
  });

  it('drops malformed messages without touching S3 or DynamoDB', async () => {
    await expect(handler(sqsEvent('{not json', JSON.stringify({ imageId: 1 })))).resolves.toBeUndefined();

    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('processes each record in a batch independently', async () => {
    const jpeg = await makeJpeg(500, 500);
    // A fresh stream per call — an SDK body can only be consumed once.
    s3Mock.on(GetObjectCommand).callsFake(async () => ({ Body: s3Body(jpeg), ContentType: 'image/jpeg' }));
    const second = JSON.stringify({ imageId: 'second', bucket: 'image-upload-test', key: 'uploads/second' });

    await handler(sqsEvent(message, second));

    expect(s3Mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Key)).toEqual([
      `processed/${VALID_UUID}`,
      'processed/second',
    ]);
  });
});
