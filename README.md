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

- **AWS Account** - [Create one here](https://aws.amazon.com/)
- **Node.js 18+** and npm - [Download here](https://nodejs.org/)
- **AWS CDK CLI** - Will be installed in step 2
- **AWS CLI** - [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **Git** - For cloning the repository

## 🚀 Getting Started from Scratch

Follow these steps to deploy the entire pipeline from scratch:

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd lambda-images
```

### Step 2: Install Dependencies

```bash
# Install project dependencies
npm install

# Install AWS CDK CLI globally (if not already installed)
npm install -g aws-cdk

# Verify installation
cdk --version
```

### Step 3: Create IAM User for Deployment

**Why?** CDK requires proper IAM permissions. Using a dedicated IAM user is more secure than using root credentials.

1. **Go to AWS Console** → IAM → Users → **Create user**
2. **User name**: `cdk-deploy-user` (or any name you prefer)
3. **Attach policies directly**: Select `AdministratorAccess`
4. **Create user**
5. **Security credentials** tab → **Create access key**
6. **Use case**: Select "Command Line Interface (CLI)"
7. **Download** or copy the Access Key ID and Secret Access Key

⚠️ **Important**: Save these credentials securely. You won't be able to see the secret key again!

### Step 4: Configure AWS CLI

```bash
# Configure AWS CLI with your IAM user credentials
aws configure --profile cdk

# You'll be prompted to enter:
# AWS Access Key ID: [paste your access key]
# AWS Secret Access Key: [paste your secret key]
# Default region name: eu-north-1
# Default output format: json

# Activate the profile for current session
export AWS_PROFILE=cdk

# Verify configuration
aws sts get-caller-identity
```

Expected output:
```json
{
    "UserId": "AIDA...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/cdk-deploy-user"
}
```

### Step 5: Bootstrap CDK

**Why?** CDK needs to create infrastructure in your AWS account to manage deployments (S3 bucket for assets, IAM roles, etc.)

**Note:** You don't need to create a `.env` file. CDK automatically detects your AWS account and region from the AWS CLI profile.

```bash
# Get your AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Get your AWS Region
AWS_REGION=$(aws configure get region)

# Bootstrap CDK with proper execution policies (only needed once per account/region)
cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION} \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

**Important:** The `--cloudformation-execution-policies` flag ensures that CDK has sufficient permissions to create and destroy all resources, including IAM roles, Lambda functions, S3 buckets, etc.

Expected output:
```
✅  Environment aws://123456789012/eu-north-1 bootstrapped.
```

### Step 6: Build the Project

```bash
# Compile TypeScript to JavaScript
npm run build
```

### Step 7: Review Infrastructure Changes (Optional)

```bash
# See what resources will be created
cdk synth

# Or see a diff (useful for updates)
npm run diff
```

### Step 8: Deploy to AWS

```bash
# Deploy the stack
npm run deploy

# You'll be asked to approve security changes
# Type 'y' and press Enter
```

⏱️ **Deployment takes ~2-3 minutes**

Expected output:
```
✅  ImageProcessingStack

Outputs:
ImageProcessingStack.ApiEndpoint = https://abc123.execute-api.eu-north-1.amazonaws.com/
ImageProcessingStack.UploadEndpoint = https://abc123.execute-api.eu-north-1.amazonaws.com/upload
ImageProcessingStack.StatusEndpoint = https://abc123.execute-api.eu-north-1.amazonaws.com/status
ImageProcessingStack.UploadBucketName = image-upload-123456789012-eu-north-1
ImageProcessingStack.ProcessedBucketName = image-processed-123456789012-eu-north-1
...
```

### Step 9: Update Frontend with API Endpoint

Copy the `ApiEndpoint` from the deployment outputs and update the frontend:

```bash
# Open public/index.html and update line 10:
# const API_ENDPOINT = 'https://YOUR_API_ID.execute-api.eu-north-1.amazonaws.com';
```

Or use this command:
```bash
# Extract API endpoint from outputs
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ImageProcessingStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

# Update frontend (macOS/Linux)
sed -i '' "s|const API_ENDPOINT = '.*'|const API_ENDPOINT = '${API_ENDPOINT}'|" public/index.html

# Update frontend (Linux without macOS)
sed -i "s|const API_ENDPOINT = '.*'|const API_ENDPOINT = '${API_ENDPOINT}'|" public/index.html
```

### Step 10: Test the Pipeline

**Option A: Web Interface (Recommended)**

```bash
# Start local web server
npm start

# Browser will open at http://localhost:3000
# 1. Select or drag & drop an image
# 2. Click "Upload and Process"
# 3. Wait ~5-10 seconds
# 4. View the processed 400x400 image
```

**Option B: Command Line**

```bash
# Test with curl
curl -X POST ${API_ENDPOINT}/upload \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Step 11: Monitor Resources (Optional)

```bash
# View Lambda logs
aws logs tail /aws/lambda/ImageProcessing-GetUploadUrl --follow

# Check DynamoDB table
aws dynamodb scan --table-name ImageProcessingTable

# List S3 buckets
aws s3 ls | grep image-

# Check SQS queue
aws sqs get-queue-attributes \
  --queue-url $(aws cloudformation describe-stacks \
    --stack-name ImageProcessingStack \
    --query 'Stacks[0].Outputs[?OutputKey==`QueueUrl`].OutputValue' \
    --output text) \
  --attribute-names ApproximateNumberOfMessages
```

## 🔄 Making Changes and Redeploying

After modifying the code:

```bash
# 1. Build
npm run build

# 2. See what changed
npm run diff

# 3. Deploy updates
npm run deploy
```

## 🧹 Cleanup

To remove all AWS resources and avoid charges:

```bash
# Destroy the stack
npm run destroy

# This will delete:
# - All Lambda functions
# - Both S3 buckets and their contents
# - DynamoDB table and all data
# - SQS queue
# - API Gateway
```

⚠️ **Note**: After `npm run destroy`, you'll need to run `cdk bootstrap` again before the next deployment.

## 📊 What Gets Created

After deployment, you'll have:

1. **API Gateway HTTP API** - Public endpoint for upload/status
2. **4 Lambda Functions**:
   - `ImageProcessing-GetUploadUrl` - Generates presigned URLs
   - `ImageProcessing-ProcessUpload` - Handles S3 events
   - `ImageProcessing-ResizeImage` - Processes images with Sharp
   - `ImageProcessing-GetStatus` - Returns processing status
3. **2 S3 Buckets**:
   - `image-upload-{account}-{region}` - Original images
   - `image-processed-{account}-{region}` - Processed images
4. **DynamoDB Table** - `ImageProcessingTable` - Metadata storage
5. **SQS Queue** - `ImageProcessingQueue` - Async processing trigger
6. **CloudWatch Logs** - Automatic logging for all Lambda functions

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

## 🔧 Troubleshooting

### Error: "No bucket named 'cdk-hnb659fds-assets'"

**Cause**: CDK bootstrap bucket doesn't exist or you're using root user credentials.

**Solution**:
```bash
# 1. Make sure you're using IAM user (not root)
aws sts get-caller-identity
# Should show: "arn:aws:iam::ACCOUNT:user/cdk-deploy-user"

# 2. Re-run bootstrap with proper execution policies
export AWS_PROFILE=cdk
cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/eu-north-1 \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

### Error: "Role arn:aws:iam::ACCOUNT:role/cdk-hnb659fds-cfn-exec-role is invalid or cannot be assumed"

**Cause**: CDK was bootstrapped without proper execution policies, so it cannot create/destroy resources.

**Solution**: Re-bootstrap with correct policies:
```bash
export AWS_PROFILE=cdk
cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/eu-north-1 \
  --force \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

### Error: "Stack is in UPDATE_ROLLBACK_FAILED state"

**Cause**: Previous deployment failed and stack is in a bad state.

**Solution**:
```bash
# Delete the failed stack
aws cloudformation delete-stack --stack-name ImageProcessingStack

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete --stack-name ImageProcessingStack

# Deploy again
npm run deploy
```

### Error: "User is not authorized to perform: sts:AssumeRole"

**Cause**: IAM user doesn't have sufficient permissions.

**Solution**:
1. Go to AWS Console → IAM → Users → Your user
2. Attach policy: `AdministratorAccess`
3. Try deployment again

### Lambda timeout errors

**Cause**: Processing large images takes longer than the configured timeout.

**Solution**: Increase timeout and memory in `lib/image-processing-stack.ts`:
```typescript
const lambda3 = new nodejs.NodejsFunction(stack, 'ResizeImageFunction', {
  timeout: cdk.Duration.seconds(600),  // Increase from 300 to 600
  memorySize: 2048,                    // Increase from 1024 to 2048
  // ...
});
```

### CORS errors in browser

**Cause**: API endpoint not configured correctly in frontend.

**Solution**:
```bash
# Get correct API endpoint
aws cloudformation describe-stacks \
  --stack-name ImageProcessingStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text

# Update public/index.html line 10 with the correct endpoint
```

### Image processing fails silently

**Cause**: Lambda function error not visible in frontend.

**Solution**: Check CloudWatch logs:
```bash
# View ResizeImage Lambda logs
aws logs tail /aws/lambda/ImageProcessing-ResizeImage --follow

# View all Lambda logs
aws logs tail /aws/lambda/ImageProcessing-ProcessUpload --follow
```

### "AccessDenied" errors in S3

**Cause**: Lambda doesn't have permissions to access S3 buckets.

**Solution**: This should be automatic via CDK. If it persists:
```bash
# Redeploy the stack
npm run deploy
```

### After `npm run destroy`, next deploy fails

**Cause**: CDK bootstrap resources were also deleted.

**Solution**:
```bash
# Re-bootstrap CDK
export AWS_PROFILE=cdk
cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/eu-north-1

# Deploy again
npm run deploy
```

### DynamoDB "ResourceNotFoundException"

**Cause**: Table doesn't exist or wrong table name.

**Solution**:
```bash
# Check if table exists
aws dynamodb describe-table --table-name ImageProcessingTable

# If not exists, redeploy
npm run deploy
```

### SQS messages not being processed

**Cause**: Lambda3 not triggered by SQS.

**Solution**: Check SQS queue depth:
```bash
# Get queue URL from outputs
QUEUE_URL=$(aws cloudformation describe-stacks \
  --stack-name ImageProcessingStack \
  --query 'Stacks[0].Outputs[?OutputKey==`QueueUrl`].OutputValue' \
  --output text)

# Check messages in queue
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages

# If messages are stuck, check Lambda3 logs
aws logs tail /aws/lambda/ImageProcessing-ResizeImage --follow
```

### Need to change AWS region

**Solution**:
```bash
# 1. Update AWS CLI profile
aws configure --profile cdk
# Enter new region (e.g., us-east-1)

# 2. Bootstrap new region
cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-east-1

# 3. Update bin/app.ts if you hardcoded region
# 4. Deploy
npm run deploy
```

## License

MIT
