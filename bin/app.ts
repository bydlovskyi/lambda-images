#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { createImageProcessingStack } from '../lib/image-processing-stack';

const app = new cdk.App();

createImageProcessingStack(app, 'ImageProcessingStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Serverless Image Processing Pipeline with S3, Lambda, SQS, and DynamoDB',
});

app.synth();
