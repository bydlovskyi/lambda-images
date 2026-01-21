#!/bin/bash

set -e

if [ -z "$1" ]; then
    echo "Usage: ./test-pipeline.sh <path-to-test-image.jpg>"
    exit 1
fi

IMAGE_PATH=$1

if [ ! -f "$IMAGE_PATH" ]; then
    echo "Error: Image file not found: $IMAGE_PATH"
    exit 1
fi

# Get API endpoint from environment variable or use default
API_ENDPOINT="${API_ENDPOINT:-https://6hrossef74.execute-api.eu-north-1.amazonaws.com}"

echo "🚀 Testing Image Processing Pipeline (API Gateway)"
echo "======================================"
echo "API Endpoint: $API_ENDPOINT"
echo ""
echo "💡 Tip: Set custom endpoint with: export API_ENDPOINT=https://your-api.amazonaws.com"

echo ""
echo "Step 1: Getting upload URL from API Gateway..."
RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{}' \
    "$API_ENDPOINT/upload")

UPLOAD_URL=$(echo $RESPONSE | jq -r '.uploadUrl')
IMAGE_ID=$(echo $RESPONSE | jq -r '.imageId')

echo "✅ Upload URL received"
echo "   Image ID: $IMAGE_ID"

echo ""
echo "Step 2: Uploading image..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT \
    -H "Content-Type: image/jpeg" \
    --data-binary @"$IMAGE_PATH" \
    "$UPLOAD_URL")

if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ Image uploaded successfully"
else
    echo "❌ Upload failed with HTTP code: $HTTP_CODE"
    exit 1
fi

echo ""
echo "Step 3: Waiting for processing (10 seconds)..."
for i in {1..10}; do
    echo -n "."
    sleep 1
done
echo ""

echo ""
echo "Step 4: Checking processing status..."
STATUS_RESPONSE=$(curl -s "$API_ENDPOINT/status?imageId=$IMAGE_ID")

STATUS=$(echo $STATUS_RESPONSE | jq -r '.status')
echo "   Status: $STATUS"

if [ "$STATUS" == "ok" ]; then
    DOWNLOAD_URL=$(echo $STATUS_RESPONSE | jq -r '.downloadUrl')
    echo "✅ Processing completed successfully!"
    echo ""
    echo "Download URL (valid for 10 minutes):"
    echo "$DOWNLOAD_URL"
    echo ""
    echo "To download the processed image:"
    echo "curl \"$DOWNLOAD_URL\" -o processed-image.jpg"
elif [ "$STATUS" == "pending" ]; then
    echo "⏳ Still processing... Try checking again in a few seconds:"
    echo "curl -s \"$API_ENDPOINT/status?imageId=$IMAGE_ID\" | jq"
elif [ "$STATUS" == "error" ]; then
    ERROR_MSG=$(echo $STATUS_RESPONSE | jq -r '.errorMessage')
    echo "❌ Processing failed: $ERROR_MSG"
    exit 1
else
    echo "❓ Unknown status: $STATUS"
    exit 1
fi

echo ""
echo "======================================"
echo "🎉 Pipeline test completed!"
