import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { apiEvent, VALID_UUID } from './helpers';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: { input: { Bucket: string; Key: string } }) => {
    return `https://signed.example/${command.input.Bucket}/${command.input.Key}`;
  }),
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { handler } from '../lambdas/get-status';
import { ImageRecord } from '../types/image-record';

const ddbMock = mockClient(DynamoDBDocumentClient);

const baseRecord: ImageRecord = {
  imageId: VALID_UUID,
  originalKey: `uploads/${VALID_UUID}`,
  bucket: 'image-upload-test',
  size: 1000,
  status: 'pending',
  uploadedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: 1_800_000_000,
};

function get(imageId?: string) {
  return handler(apiEvent({ queryStringParameters: imageId === undefined ? null : { imageId } }));
}

describe('get-status', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.mocked(getSignedUrl).mockClear();
  });

  it('returns 400 when imageId is missing', async () => {
    const res = await get();
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/imageId/);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it('returns 400 for an imageId that is not a UUID', async () => {
    const res = await get('../etc/passwd');
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it('returns 404 when the record does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await get(VALID_UUID);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Image not found' });
  });

  it('returns pending status without a download URL', async () => {
    ddbMock.on(GetCommand).resolves({ Item: baseRecord });
    const res = await get(VALID_UUID);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      imageId: VALID_UUID,
      status: 'pending',
      uploadedAt: baseRecord.uploadedAt,
    });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns a presigned download URL once processing is done', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { ...baseRecord, status: 'ok', processedKey: `processed/${VALID_UUID}`, processedAt: '2026-01-01T00:00:05.000Z' },
    });
    const res = await get(VALID_UUID);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      imageId: VALID_UUID,
      status: 'ok',
      uploadedAt: baseRecord.uploadedAt,
      processedAt: '2026-01-01T00:00:05.000Z',
      downloadUrl: `https://signed.example/image-processed-test/processed/${VALID_UUID}`,
      expiresIn: 600,
    });
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 600 });
  });

  it('surfaces the stored error message for failed images', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...baseRecord, status: 'error', errorMessage: 'Input buffer contains unsupported image format' } });
    const res = await get(VALID_UUID);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'error', errorMessage: 'Input buffer contains unsupported image format' });
  });

  it('does not leak internal error details on 500', async () => {
    ddbMock.on(GetCommand).rejects(new Error('arn:aws:dynamodb:… AccessDeniedException'));
    const res = await get(VALID_UUID);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'Failed to get image status' });
    expect(res.body).not.toContain('AccessDenied');
  });
});
