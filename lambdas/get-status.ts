import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ImageRecord, StatusResponse } from '../types/image-record';
import { errorResponse, jsonResponse } from './shared/http';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const PROCESSED_BUCKET_NAME = process.env.PROCESSED_BUCKET_NAME!;
const URL_EXPIRATION = 600;
const IMAGE_ID_PATTERN = /^[0-9a-f-]{36}$/i;

/** GET /status?imageId=… — current processing state plus a download URL once ready. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const imageId = event.queryStringParameters?.imageId;
  if (!imageId) {
    return errorResponse(400, 'Missing imageId parameter');
  }
  if (!IMAGE_ID_PATTERN.test(imageId)) {
    return errorResponse(400, 'imageId must be a UUID');
  }

  try {
    const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { imageId } }));
    const item = result.Item as ImageRecord | undefined;
    if (!item) {
      return errorResponse(404, 'Image not found');
    }

    const response: StatusResponse = {
      imageId: item.imageId,
      status: item.status,
      uploadedAt: item.uploadedAt,
    };

    if (item.status === 'ok' && item.processedKey) {
      response.downloadUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: PROCESSED_BUCKET_NAME, Key: item.processedKey }),
        { expiresIn: URL_EXPIRATION }
      );
      response.processedAt = item.processedAt;
      response.expiresIn = URL_EXPIRATION;
    } else if (item.status === 'error') {
      response.errorMessage = item.errorMessage;
    }

    return jsonResponse(200, response);
  } catch (error) {
    console.error(`Error getting status for ${imageId}:`, error);
    return errorResponse(500, 'Failed to get image status');
  }
};
