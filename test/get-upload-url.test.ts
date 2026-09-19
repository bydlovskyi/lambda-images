import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { apiEvent } from './helpers';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: { input: Record<string, unknown> }, options: unknown) => {
    // Echo the inputs so tests can assert on what was signed.
    return `https://signed.example/${command.input.Key}?${JSON.stringify({ input: command.input, options: serialise(options) })}`;
  }),
}));

function serialise(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (v instanceof Set ? [...v] : v)));
}

import { handler } from '../lambdas/get-upload-url';
import { MAX_UPLOAD_BYTES } from '../types/image-record';

const s3Mock = mockClient(S3Client);

function post(body: unknown) {
  return handler(apiEvent({ httpMethod: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
}

describe('get-upload-url', () => {
  beforeEach(() => s3Mock.reset());

  it('returns a presigned URL with the declared content type and length signed', async () => {
    const res = await post({ contentType: 'image/png', contentLength: 1234 });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.imageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.key).toBe(`uploads/${body.imageId}`);
    expect(body.expiresIn).toBe(300);

    const signed = JSON.parse(decodeURIComponent(body.uploadUrl.split('?')[1]));
    expect(signed.input).toMatchObject({
      Bucket: 'image-upload-test',
      Key: body.key,
      ContentType: 'image/png',
      ContentLength: 1234,
    });
    expect(signed.options.signableHeaders).toEqual(expect.arrayContaining(['content-type', 'content-length']));
  });

  it('rejects an unsupported content type', async () => {
    const res = await post({ contentType: 'application/zip', contentLength: 10 });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/contentType/);
  });

  it('rejects uploads above the size limit', async () => {
    const res = await post({ contentType: 'image/jpeg', contentLength: MAX_UPLOAD_BYTES + 1 });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/limit/);
  });

  it.each([
    ['missing length', { contentType: 'image/jpeg' }],
    ['zero length', { contentType: 'image/jpeg', contentLength: 0 }],
    ['fractional length', { contentType: 'image/jpeg', contentLength: 1.5 }],
    ['non-object body', '[]'],
    ['empty body', ''],
    ['invalid JSON', '{not json'],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('sets JSON and CORS headers on every response', async () => {
    const res = await post({});
    expect(res.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
  });
});
