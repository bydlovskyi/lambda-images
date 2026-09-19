import { APIGatewayProxyResult } from 'aws-lambda';

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

/** Serialise a JSON body with the headers every endpoint returns. */
export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(body),
  };
}

/** Error responses never carry internal details — those go to CloudWatch. */
export function errorResponse(statusCode: number, error: string): APIGatewayProxyResult {
  return jsonResponse(statusCode, { error });
}
