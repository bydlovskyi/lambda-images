# AWS Image Processing Pipeline

Serverless image processing pipeline using AWS services (S3, SQS, DynamoDB, and Lambda) to automatically process uploaded images.

## Architecture

The pipeline consists of 4 Lambda functions:

1. **Lambda1 (Get Upload URL)** - Generates presigned S3 upload URL
2. **Lambda2 (Process Upload)** - Triggered by S3 event, creates DynamoDB record and sends SQS message
3. **Lambda3 (Resize Image)** - Triggered by SQS, resizes image to 400x400 and updates DynamoDB
4. **Lambda4 (Get Status)** - Returns processing status and download URL if ready

## AWS Resources

- **S3 Bucket 1 (Upload)**: Private bucket for original images
- **S3 Bucket 2 (Processed)**: Private bucket for resized images
- **DynamoDB Table**: Stores image metadata and processing status
- **SQS Queue**: Triggers Lambda3 for image processing
- **4 Lambda Functions**: Handle the processing pipeline

## Prerequisites

- AWS Account with configured credentials
- Node.js 18+ and npm
- AWS CDK CLI: `npm install -g aws-cdk`
- AWS CLI configured with appropriate permissions

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd lambdas-image
```

2. Install dependencies:
```bash
npm install
```

3. Install Lambda dependencies:
```bash
cd lambdas/lambda1-get-upload-url && npm install && cd ../..
cd lambdas/lambda2-process-upload && npm install && cd ../..
cd lambdas/lambda3-resize-image && npm install && cd ../..
cd lambdas/lambda4-get-status && npm install && cd ../..
```

4. Bootstrap CDK (first time only):
```bash
cdk bootstrap
```

## Deployment

1. Build TypeScript:
```bash
npm run build
```

2. Review changes:
```bash
npm run diff
```

3. Deploy to AWS:
```bash
npm run deploy
```

4. Note the outputs (Lambda function names, bucket names, etc.)

## Usage

### 1. Get Upload URL

Invoke Lambda1 to get a presigned upload URL:

```bash
aws lambda invoke \
  --function-name ImageProcessing-GetUploadUrl \
  --payload '{}' \
  response.json

cat response.json
```

Response:
```json
{
  "uploadUrl": "https://...",
  "imageId": "uuid",
  "key": "uploads/uuid",
  "expiresIn": 300
}
```

### 2. Upload Image

Upload an image using the presigned URL:

```bash
curl -X PUT \
  -H "Content-Type: image/jpeg" \
  --data-binary @your-image.jpg \
  "<uploadUrl>"
```

### 3. Check Status

Check processing status using Lambda4:

```bash
aws lambda invoke \
  --function-name ImageProcessing-GetStatus \
  --payload '{"queryStringParameters":{"imageId":"<your-image-id>"}}' \
  status.json

cat status.json
```

Response (pending):
```json
{
  "imageId": "uuid",
  "status": "pending",
  "uploadedAt": "2024-01-01T00:00:00.000Z"
}
```

Response (completed):
```json
{
  "imageId": "uuid",
  "status": "ok",
  "uploadedAt": "2024-01-01T00:00:00.000Z",
  "processedAt": "2024-01-01T00:00:10.000Z",
  "downloadUrl": "https://...",
  "expiresIn": 600
}
```

### 4. Download Processed Image

Use the `downloadUrl` from step 3:

```bash
curl "<downloadUrl>" -o processed-image.jpg
```

## Testing

You can test the entire pipeline with a sample image:

```bash
# 1. Get upload URL
RESPONSE=$(aws lambda invoke --function-name ImageProcessing-GetUploadUrl --payload '{}' /dev/stdout | tail -1)
UPLOAD_URL=$(echo $RESPONSE | jq -r '.uploadUrl')
IMAGE_ID=$(echo $RESPONSE | jq -r '.imageId')

# 2. Upload image
curl -X PUT -H "Content-Type: image/jpeg" --data-binary @test-image.jpg "$UPLOAD_URL"

# 3. Wait a few seconds for processing
sleep 10

# 4. Check status and get download URL
aws lambda invoke \
  --function-name ImageProcessing-GetStatus \
  --payload "{\"queryStringParameters\":{\"imageId\":\"$IMAGE_ID\"}}" \
  /dev/stdout | tail -1 | jq
```

## DynamoDB Schema

**Table Name**: `ImageProcessingTable`

**Partition Key**: `imageId` (String)

**Attributes**:
- `imageId`: Unique identifier (UUID)
- `originalKey`: S3 key of original image
- `processedKey`: S3 key of processed image
- `bucket`: Source bucket name
- `size`: Original file size in bytes
- `status`: Processing status (`pending`, `ok`, `error`)
- `uploadedAt`: ISO timestamp of upload
- `processedAt`: ISO timestamp of processing completion
- `errorMessage`: Error message if status is `error`

## Cleanup

To remove all resources:

```bash
npm run destroy
```

## Project Structure

```
.
├── bin/
│   └── app.ts                    # CDK app entry point
├── lib/
│   └── image-processing-stack.ts # CDK stack definition
├── lambdas/
│   ├── lambda1-get-upload-url/   # Get presigned upload URL
│   ├── lambda2-process-upload/   # Process S3 events
│   ├── lambda3-resize-image/     # Resize images
│   └── lambda4-get-status/       # Get processing status
├── diagrams/
│   └── architecture.png          # Architecture diagram
├── package.json
├── tsconfig.json
├── cdk.json
└── README.md
```

## Technology Stack

- **Language**: TypeScript
- **Infrastructure**: AWS CDK
- **Runtime**: Node.js 20.x
- **Image Processing**: Sharp library
- **AWS Services**: Lambda, S3, SQS, DynamoDB

## Cost Estimation

This is a serverless application with pay-per-use pricing:

- **Lambda**: Free tier includes 1M requests/month
- **S3**: $0.023 per GB stored
- **DynamoDB**: Free tier includes 25 GB storage
- **SQS**: Free tier includes 1M requests/month

Estimated cost for 1000 images/month: < $1

## Troubleshooting

### Lambda timeout
If processing large images, increase Lambda3 timeout and memory in `lib/image-processing-stack.ts`

### Permission errors
Ensure AWS credentials have permissions for Lambda, S3, DynamoDB, SQS, and IAM

### Image processing fails
Check Lambda3 CloudWatch logs for detailed error messages

## License

MIT
