import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import {
  ALLOWED_CONTENT_TYPES,
  AllowedContentType,
  MAX_UPLOAD_BYTES,
  UploadUrlRequest,
  UploadUrlResponse,
} from '../types/image-record';
import { errorResponse, jsonResponse } from './shared/http';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.UPLOAD_BUCKET_NAME!;
const URL_EXPIRATION = 300;

function isAllowedContentType(value: string): value is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Parse and validate the request body; returns an error message when invalid. */
function parseRequest(body: string | null): UploadUrlRequest | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? '');
  } catch {
    return 'Request body must be valid JSON';
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return 'Request body must be a JSON object';
  }
  const { contentType, contentLength } = parsed as Record<string, unknown>;

  if (typeof contentType !== 'string' || !isAllowedContentType(contentType)) {
    return `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`;
  }
  if (typeof contentLength !== 'number' || !Number.isInteger(contentLength) || contentLength <= 0) {
    return 'contentLength must be a positive integer (bytes)';
  }
  if (contentLength > MAX_UPLOAD_BYTES) {
    return `contentLength exceeds the ${MAX_UPLOAD_BYTES} byte limit`;
  }
  return { contentType, contentLength };
}

/**
 * POST /upload — issue a short-lived presigned PUT URL.
 *
 * Content-Type and Content-Length are part of the signature, so the client
 * can only upload the exact file type and size it declared here. Anything
 * else is rejected by S3 before it ever reaches the pipeline.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const request = parseRequest(event.body);
  if (typeof request === 'string') {
    return errorResponse(400, request);
  }

  try {
    const imageId = randomUUID();
    const key = `uploads/${imageId}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: request.contentType,
      ContentLength: request.contentLength,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: URL_EXPIRATION,
      signableHeaders: new Set(['content-type', 'content-length']),
    });

    const response: UploadUrlResponse = { uploadUrl, imageId, key, expiresIn: URL_EXPIRATION };
    return jsonResponse(200, response);
  } catch (error) {
    console.error('Error generating upload URL:', error);
    return errorResponse(500, 'Failed to generate upload URL');
  }
};
