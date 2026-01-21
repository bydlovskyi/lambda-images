# Deployment Guide

## Prerequisites

### 1. AWS Account Setup
- Active AWS account
- AWS CLI installed and configured
- Appropriate IAM permissions for:
  - Lambda
  - S3
  - DynamoDB
  - SQS
  - IAM
  - CloudFormation

### 2. Local Environment
```bash
# Check Node.js version (18+ required)
node --version

# Check npm version
npm --version

# Check AWS CLI
aws --version

# Verify AWS credentials
aws sts get-caller-identity
```

### 3. Install AWS CDK
```bash
npm install -g aws-cdk

# Verify installation
cdk --version
```

## Step-by-Step Deployment

### Step 1: Clone and Install Dependencies

```bash
# Clone repository
git clone <repository-url>
cd lambda-images

# Install dependencies (all Lambda code in single lambdas/ folder)
npm install
```

**Note:** Lambda functions are now bundled by CDK automatically using `NodejsFunction`. No need to install dependencies in separate folders.

### Step 2: Configure AWS Environment

```bash
# Set your AWS region (optional, defaults to us-east-1)
export CDK_DEFAULT_REGION=us-east-1

# Verify your AWS account
aws sts get-caller-identity
```

### Step 3: Bootstrap CDK (First Time Only)

```bash
# Bootstrap CDK in your AWS account
cdk bootstrap aws://ACCOUNT-ID/REGION

# Example:
# cdk bootstrap aws://123456789012/us-east-1
```

### Step 4: Build TypeScript

```bash
npm run build
```

### Step 5: Review Changes

```bash
# See what will be deployed
cdk diff
```

### Step 6: Deploy

```bash
# Deploy the stack
npm run deploy

# Or with CDK directly
cdk deploy

# Auto-approve (skip confirmation)
cdk deploy --require-approval never
```

### Step 7: Note the Outputs

After deployment, you'll see outputs like:
```
Outputs:
ImageProcessingStack.ApiEndpoint = https://xxxxx.execute-api.eu-north-1.amazonaws.com
ImageProcessingStack.UploadEndpoint = https://xxxxx.execute-api.eu-north-1.amazonaws.com/upload
ImageProcessingStack.StatusEndpoint = https://xxxxx.execute-api.eu-north-1.amazonaws.com/status
ImageProcessingStack.Lambda1FunctionName = ImageProcessing-GetUploadUrl
ImageProcessingStack.Lambda2FunctionName = ImageProcessing-ProcessUpload
ImageProcessingStack.Lambda3FunctionName = ImageProcessing-ResizeImage
ImageProcessingStack.Lambda4FunctionName = ImageProcessing-GetStatus
ImageProcessingStack.UploadBucketName = image-upload-123456789012-eu-north-1
ImageProcessingStack.ProcessedBucketName = image-processed-123456789012-eu-north-1
ImageProcessingStack.TableName = ImageProcessingTable
ImageProcessingStack.QueueUrl = https://sqs.eu-north-1.amazonaws.com/...
```

**Save these values!** You'll need them for testing.

### Step 8: Configure Frontend

Update the API endpoint in `public/index.html`:

```bash
# Open public/index.html and update line 13:
const API_ENDPOINT = 'https://YOUR_API_ID.execute-api.eu-north-1.amazonaws.com';

# Replace with the ApiEndpoint from CDK outputs
```

### Step 9: Test Frontend Locally

```bash
# Start local web server
npm start

# Opens browser at http://localhost:3000
# Upload an image and test the full pipeline
```

## Testing the Deployment

### Option 1: Web Interface (Recommended)

```bash
# Start local web server
npm start

# Opens browser at http://localhost:3000
# 1. Select an image
# 2. Click "Завантажити та обробити"
# 3. Wait for processing (auto-polling)
# 4. View processed 400x400 image
```

### Option 2: API Testing

#### Using API Gateway Endpoints

```bash
# Get upload URL via API Gateway
curl -X POST https://YOUR_API_ID.execute-api.eu-north-1.amazonaws.com/upload \
  -H "Content-Type: application/json" \
  -d '{}'

# Check status via API Gateway
curl "https://YOUR_API_ID.execute-api.eu-north-1.amazonaws.com/status?imageId=YOUR_IMAGE_ID"
```

### Option 3: Quick Test Script

```bash
# Make test script executable
chmod +x scripts/test-pipeline.sh

# Run test with your image
./scripts/test-pipeline.sh path/to/your/image.jpg
```

### Option 4: Manual Testing with Lambda

#### 1. Get Upload URL
```bash
aws lambda invoke \
  --function-name ImageProcessing-GetUploadUrl \
  --payload '{}' \
  response.json

cat response.json
```

#### 2. Upload Image
```bash
# Extract URL from response
UPLOAD_URL=$(cat response.json | jq -r '.uploadUrl')
IMAGE_ID=$(cat response.json | jq -r '.imageId')

# Upload
curl -X PUT \
  -H "Content-Type: image/jpeg" \
  --data-binary @test-image.jpg \
  "$UPLOAD_URL"
```

#### 3. Check Status
```bash
# Wait a few seconds, then check
sleep 10

aws lambda invoke \
  --function-name ImageProcessing-GetStatus \
  --payload "{\"queryStringParameters\":{\"imageId\":\"$IMAGE_ID\"}}" \
  status.json

cat status.json
```

#### 4. Download Processed Image
```bash
DOWNLOAD_URL=$(cat status.json | jq -r '.downloadUrl')
curl "$DOWNLOAD_URL" -o processed-image.jpg
```

## Monitoring

### CloudWatch Logs

```bash
# View Lambda 1 logs
aws logs tail /aws/lambda/ImageProcessing-GetUploadUrl --follow

# View Lambda 2 logs
aws logs tail /aws/lambda/ImageProcessing-ProcessUpload --follow

# View Lambda 3 logs
aws logs tail /aws/lambda/ImageProcessing-ResizeImage --follow

# View Lambda 4 logs
aws logs tail /aws/lambda/ImageProcessing-GetStatus --follow
```

### DynamoDB

```bash
# Scan table
aws dynamodb scan --table-name ImageProcessingTable

# Get specific item
aws dynamodb get-item \
  --table-name ImageProcessingTable \
  --key "{\"imageId\":{\"S\":\"your-image-id\"}}"
```

### SQS Queue

```bash
# Get queue attributes
aws sqs get-queue-attributes \
  --queue-url <your-queue-url> \
  --attribute-names All
```

## Updating the Stack

```bash
# Make your changes to the code

# Build
npm run build

# Review changes
npm run diff

# Deploy updates
npm run deploy
```

## Rollback

```bash
# If something goes wrong, you can destroy and redeploy
npm run destroy
npm run deploy
```

## Cleanup

To remove all resources:

```bash
npm run destroy

# Or with CDK directly
cdk destroy
```

**Warning:** This will delete:
- All Lambda functions
- Both S3 buckets and their contents
- DynamoDB table and all data
- SQS queue and messages

## Troubleshooting

### Issue: CDK Bootstrap Error
```
Solution: Run cdk bootstrap with your account and region
cdk bootstrap aws://ACCOUNT-ID/REGION
```

### Issue: Lambda Timeout
```
Solution: Increase timeout in lib/image-processing-stack.ts
timeout: cdk.Duration.seconds(300)
```

### Issue: Sharp Library Error in Lambda3
```
Solution: The bundling configuration in CDK handles this automatically.
If issues persist, check Lambda logs for specific error messages.
```

### Issue: Permission Denied
```
Solution: Verify your IAM user/role has necessary permissions:
- AWSLambda_FullAccess
- AmazonS3FullAccess
- AmazonDynamoDBFullAccess
- AmazonSQSFullAccess
- IAMFullAccess (for role creation)
- AWSCloudFormationFullAccess
```

### Issue: Image Processing Fails
```
Solution: Check Lambda3 CloudWatch logs:
aws logs tail /aws/lambda/ImageProcessing-ResizeImage --follow

Common causes:
- Unsupported image format
- Image too large (increase Lambda memory)
- Timeout (increase Lambda timeout)
```

## Cost Optimization

### Development
- Use small test images
- Delete processed images regularly
- Monitor CloudWatch logs retention

### Production
- Set up S3 lifecycle policies to delete old images
- Configure DynamoDB auto-scaling
- Set Lambda reserved concurrency limits
- Enable S3 Intelligent-Tiering

## Security Best Practices

1. **Enable S3 bucket versioning** (optional)
2. **Set up CloudTrail** for audit logging
3. **Enable AWS Config** for compliance
4. **Use VPC** for Lambda functions (optional)
5. **Rotate credentials** regularly
6. **Enable MFA** for AWS account
7. **Use least privilege** IAM policies

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
│   ├── index.html                # Frontend web interface
│   └── SETUP.md                  # Frontend setup guide
├── diagrams/
│   ├── architecture.md           # Text architecture diagram
│   └── architecture-mermaid.md   # Mermaid diagrams
├── scripts/
│   └── test-pipeline.sh          # Testing script
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
├── cdk.json                      # CDK config
├── README.md                     # Project overview
├── DEPLOYMENT.md                 # This file
├── ARCHITECTURE_ANALYSIS.md      # Detailed architecture analysis
├── IMPROVEMENTS_GUIDE.md         # Code improvements guide
├── FLOW_DIAGRAM.md               # Data flow diagrams
└── COMPLIANCE_REPORT.md          # Requirements compliance
```

## API Gateway Endpoints

After deployment, you'll have:

- **POST /upload** - Get presigned upload URL
  - Request: `{}`
  - Response: `{ uploadUrl, imageId, key, expiresIn }`

- **GET /status?imageId={id}** - Check processing status
  - Request: Query parameter `imageId`
  - Response: `{ imageId, status, uploadedAt, processedAt?, downloadUrl?, expiresIn? }`

## Architecture Components

### AWS Resources Created:

1. **API Gateway HTTP API** - REST endpoints
2. **Lambda Functions** (4):
   - GetUploadUrl (Node.js 20.x, 30s timeout)
   - ProcessUpload (Node.js 20.x, 30s timeout)
   - ResizeImage (Node.js 20.x, 300s timeout, 1024 MB, Sharp)
   - GetStatus (Node.js 20.x, 30s timeout)
3. **S3 Buckets** (2):
   - Upload bucket (private, encrypted)
   - Processed bucket (private, encrypted)
4. **DynamoDB Table** - Image metadata and status
5. **SQS Queue** - Async processing trigger
6. **IAM Roles** - Least privilege permissions
7. **CloudWatch Logs** - All Lambda logs

### Data Flow:

1. User → API Gateway → Lambda1 → Presigned URL
2. User → S3 Upload Bucket (presigned URL)
3. S3 Event → Lambda2 → DynamoDB + SQS
4. SQS → Lambda3 → Resize (400x400) → S3 Processed → DynamoDB
5. User → API Gateway → Lambda4 → DynamoDB → Presigned Download URL

## Next Steps

### Implemented:
- ✅ API Gateway for REST API
- ✅ Frontend web interface
- ✅ CloudWatch Logs
- ✅ Infrastructure as Code (CDK)
- ✅ TypeScript for all code
- ✅ Image resize to 400x400
- ✅ Presigned URLs (5 min upload, 10 min download)

### Recommended Improvements:
- Add authentication (Cognito, API keys)
- Implement Dead Letter Queue for SQS
- Add CloudWatch Alarms
- Set up CI/CD pipeline (GitHub Actions)
- Add CloudFront for global distribution
- Implement S3 Lifecycle policies
- Add DynamoDB TTL
- Support multiple image sizes
- Add image format validation
- Enable X-Ray tracing

See `IMPROVEMENTS_GUIDE.md` for detailed implementation examples.
