#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ImageProcessingStack } from '../lib/image-processing-stack';

const app = new cdk.App();

new ImageProcessingStack(app, 'ImageProcessingStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'Serverless image processing pipeline: S3 → Lambda → SQS → Sharp → DynamoDB',
  // cdk deploy -c alarmEmail=you@example.com  (or ALARM_EMAIL=…)
  alarmEmail: app.node.tryGetContext('alarmEmail') ?? process.env.ALARM_EMAIL,
});
