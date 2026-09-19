import { APIGatewayProxyEvent, S3Event, SQSEvent } from 'aws-lambda';
import sharp from 'sharp';

export function apiEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '/',
    ...overrides,
  };
}

export function sqsEvent(...bodies: string[]): SQSEvent {
  return {
    Records: bodies.map((body, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `rh-${i}`,
      body,
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '0',
        SenderId: 'sender',
        ApproximateFirstReceiveTimestamp: '0',
      },
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:eu-north-1:123456789012:ImageProcessingQueue',
      awsRegion: 'eu-north-1',
    })),
  };
}

export function s3Event(bucket: string, key: string, size: number): S3Event {
  return {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'eu-north-1',
        eventTime: '2026-01-01T00:00:00.000Z',
        eventName: 'ObjectCreated:Put',
        userIdentity: { principalId: 'x' },
        requestParameters: { sourceIPAddress: '127.0.0.1' },
        responseElements: { 'x-amz-request-id': 'x', 'x-amz-id-2': 'x' },
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'cfg',
          bucket: { name: bucket, ownerIdentity: { principalId: 'x' }, arn: `arn:aws:s3:::${bucket}` },
          object: { key, size, eTag: 'etag', sequencer: '0' },
        },
      },
    ],
  };
}

/** A real, decodable image so Sharp runs for real in tests. */
export function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } } })
    .jpeg()
    .toBuffer();
}

export const VALID_UUID = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
