export interface ImageRecord {
  imageId: string;
  originalKey: string;
  processedKey?: string;
  bucket: string;
  size: number;
  status: 'pending' | 'ok' | 'error';
  uploadedAt: string;
  processedAt?: string;
  errorMessage?: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  imageId: string;
  key: string;
  expiresIn: number;
}

export interface StatusResponse {
  imageId: string;
  status: 'pending' | 'ok' | 'error';
  uploadedAt: string;
  processedAt?: string;
  downloadUrl?: string;
  expiresIn?: number;
  errorMessage?: string;
}

export interface SQSMessage {
  imageId: string;
  bucket: string;
  key: string;
}
