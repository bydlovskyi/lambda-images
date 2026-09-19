/**
 * Shared contracts for the image processing pipeline.
 * Imported by every Lambda so the DynamoDB schema, SQS payload and
 * HTTP responses are defined exactly once.
 */

export type ImageStatus = 'pending' | 'ok' | 'error';

/** Content types the upload endpoint will sign a presigned URL for. */
export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** Hard cap for a single upload, enforced by the presigned URL signature. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** How long a record (and its objects) live before being cleaned up. */
export const RECORD_TTL_DAYS = 7;

/** Item stored in the DynamoDB table. Partition key: imageId. */
export interface ImageRecord {
  imageId: string;
  originalKey: string;
  processedKey?: string;
  bucket: string;
  size: number;
  status: ImageStatus;
  uploadedAt: string;
  processedAt?: string;
  errorMessage?: string;
  /** Unix epoch seconds; DynamoDB TTL attribute. */
  expiresAt: number;
}

/** Body of POST /upload. */
export interface UploadUrlRequest {
  contentType: string;
  contentLength: number;
}

/** Response of POST /upload. */
export interface UploadUrlResponse {
  uploadUrl: string;
  imageId: string;
  key: string;
  expiresIn: number;
}

/** Response of GET /status?imageId=... */
export interface StatusResponse {
  imageId: string;
  status: ImageStatus;
  uploadedAt: string;
  processedAt?: string;
  downloadUrl?: string;
  expiresIn?: number;
  errorMessage?: string;
}

/** Message published to the processing queue by ProcessUpload. */
export interface SQSMessage {
  imageId: string;
  bucket: string;
  key: string;
}

export function isSQSMessage(value: unknown): value is SQSMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.imageId === 'string' && typeof v.bucket === 'string' && typeof v.key === 'string';
}
