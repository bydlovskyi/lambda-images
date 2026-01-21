import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const PROCESSED_BUCKET_NAME = process.env.PROCESSED_BUCKET_NAME!;
const URL_EXPIRATION = 600;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const imageId = event.pathParameters?.imageId || event.queryStringParameters?.imageId;

    if (!imageId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Missing imageId parameter',
        }),
      };
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { imageId },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Image not found',
        }),
      };
    }

    const item = result.Item;
    const response: any = {
      imageId: item.imageId,
      status: item.status,
      uploadedAt: item.uploadedAt,
    };

    if (item.status === 'ok' && item.processedKey) {
      const command = new GetObjectCommand({
        Bucket: PROCESSED_BUCKET_NAME,
        Key: item.processedKey,
      });

      const downloadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: URL_EXPIRATION,
      });

      response.downloadUrl = downloadUrl;
      response.processedAt = item.processedAt;
      response.expiresIn = URL_EXPIRATION;
    } else if (item.status === 'error') {
      response.errorMessage = item.errorMessage;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error getting image status:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to get image status',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
