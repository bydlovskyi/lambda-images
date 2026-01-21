# AWS Image Processing Pipeline

Serverless image processing pipeline using AWS services (S3, SQS, DynamoDB, and Lambda) to automatically process uploaded images.

## Architecture

The pipeline consists of:

- **API Gateway HTTP API** - REST endpoints for upload and status
- **4 Lambda Functions**:
  1. **GetUploadUrl** - Generates presigned S3 upload URL (300s TTL)
  2. **ProcessUpload** - Triggered by S3 event, creates DynamoDB record and sends SQS message
  3. **ResizeImage** - Triggered by SQS, resizes image to 400x400 using Sharp
  4. **GetStatus** - Returns processing status and download URL (600s TTL)
- **Frontend** - Web interface with drag & drop upload

## AWS Resources

- **API Gateway HTTP API**: REST endpoints (`/upload`, `/status`)
- **S3 Bucket (Upload)**: Private bucket for original images with encryption
- **S3 Bucket (Processed)**: Private bucket for resized images with encryption
- **DynamoDB Table**: Stores image metadata and processing status
- **SQS Queue**: Async trigger for image processing
- **4 Lambda Functions**: Node.js 20.x with automatic bundling
- **CloudWatch Logs**: All Lambda execution logs

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

3. Create IAM User (required for CDK):
   - AWS Console → IAM → Users → Create user
   - Username: `cdk-deploy-user`
   - Attach policy: `AdministratorAccess`
   - Create access key for CLI

4. Configure AWS CLI:
```bash
aws configure --profile cdk
# Enter your IAM user credentials
# Region: eu-north-1
# Output: json

export AWS_PROFILE=cdk
```

5. Bootstrap CDK (first time only):
```bash
cdk bootstrap aws://YOUR_ACCOUNT_ID/eu-north-1
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

### Option 1: Web Interface (Recommended)

```bash
npm start
# Opens http://localhost:3000
# 1. Select or drag & drop an image
# 2. Click "Upload and Process"
# 3. Wait ~10 seconds
# 4. View processed 400x400 image
```

### Option 2: API Endpoints

#### 1. Get Upload URL

```bash
curl -X POST https://YOUR_API_ID.execute-api.eu-north-1.amazonaws.com/upload \
  -H "Content-Type: application/json" \
  -d '{}'
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

#### 3. Check Status

```bash
curl "https://YOUR_API_ID.execute-api.eu-north-1.amazonaws.com/status?imageId=<your-image-id>"
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

### Test Script

```bash
# Set your API endpoint
export API_ENDPOINT=https://YOUR_API_ID.execute-api.eu-north-1.amazonaws.com

# Run test
./scripts/test-pipeline.sh path/to/image.jpg
```

### Manual Testing

```bash
# 1. Get upload URL
RESPONSE=$(curl -s -X POST $API_ENDPOINT/upload -H "Content-Type: application/json" -d '{}')
UPLOAD_URL=$(echo $RESPONSE | jq -r '.uploadUrl')
IMAGE_ID=$(echo $RESPONSE | jq -r '.imageId')

# 2. Upload image
curl -X PUT -H "Content-Type: image/jpeg" --data-binary @test-image.jpg "$UPLOAD_URL"

# 3. Wait for processing
sleep 10

# 4. Check status
curl "$API_ENDPOINT/status?imageId=$IMAGE_ID" | jq
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
lambda-images/
├── bin/
│   └── app.ts                    # CDK app entry point
├── lib/
│   └── image-processing-stack.ts # CDK stack (all infrastructure)
├── lambdas/
│   ├── get-upload-url.ts         # Lambda 1: Generate presigned URL
│   ├── process-upload.ts         # Lambda 2: S3 event handler
│   ├── resize-image.ts           # Lambda 3: Image processing (Sharp)
│   └── get-status.ts             # Lambda 4: Status checker
├── public/
│   └── index.html                # Frontend web interface
├── diagrams/
│   └── architecture-mermaid.md   # Mermaid architecture diagrams
├── scripts/
│   └── test-pipeline.sh          # Testing script
├── types/
│   └── image-record.ts           # TypeScript types
├── package.json
├── tsconfig.json
├── cdk.json
├── DEPLOYMENT.md                 # Deployment guide
├── CONTRIBUTING.md               # Contribution guidelines
└── README.md                     # This file
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
