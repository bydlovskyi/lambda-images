import { describe, it, expect, beforeAll } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ImageProcessingStack } from '../lib/image-processing-stack';

/**
 * Infrastructure assertions. These pin the operational guarantees the
 * README promises: dead-lettering, sane visibility timeout, TTL, retention.
 */
describe('ImageProcessingStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } }); // skip esbuild during tests
    const stack = new ImageProcessingStack(app, 'TestStack', { env: { account: '123456789012', region: 'eu-north-1' } });
    template = Template.fromStack(stack);
  });

  it('routes failed messages to a dead-letter queue after 3 attempts', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'ImageProcessingQueue',
      RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
    });
    template.hasResourceProperties('AWS::SQS::Queue', { QueueName: 'ImageProcessingDLQ' });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: 'ImageProcessing-DLQ-NotEmpty' });
  });

  it('keeps the queue visibility timeout at 6× the consumer timeout', () => {
    const fn = template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'ImageProcessing-ResizeImage' },
    });
    const timeout = Object.values(fn)[0].Properties.Timeout as number;
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'ImageProcessingQueue',
      VisibilityTimeout: timeout * 6,
    });
  });

  it('enables TTL on the expiresAt attribute', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
  });

  it('gives every function a log group with finite retention', () => {
    const functions = template.findResources('AWS::Lambda::Function');
    const logGroups = template.findResources('AWS::Logs::LogGroup', {
      Properties: { LogGroupName: Match.stringLikeRegexp('^/aws/lambda/ImageProcessing-') },
    });
    const ours = Object.values(functions).filter((f) => String(f.Properties.FunctionName).startsWith('ImageProcessing-'));
    expect(ours).toHaveLength(4);
    expect(Object.keys(logGroups)).toHaveLength(4);
    for (const lg of Object.values(logGroups)) {
      expect(lg.Properties.RetentionInDays).toBe(14);
    }
  });

  it('keeps buckets private, encrypted and TLS-only with object expiry', () => {
    const buckets = template.findResources('AWS::S3::Bucket');
    expect(Object.keys(buckets)).toHaveLength(2);
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toMatchObject({ BlockPublicAcls: true, RestrictPublicBuckets: true });
      expect(bucket.Properties.BucketEncryption).toBeDefined();
      expect(bucket.Properties.LifecycleConfiguration.Rules[0]).toMatchObject({ ExpirationInDays: 7, Status: 'Enabled' });
    }
    template.resourceCountIs('AWS::S3::BucketPolicy', 2);
  });

  it('exposes exactly the two public routes', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /upload' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /status' });
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 2);
  });

  it('only the resize worker consumes the queue, one message at a time', () => {
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
      ScalingConfig: { MaximumConcurrency: 10 },
    });
  });
});
