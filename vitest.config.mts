import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Every handler reads its configuration from process.env at module load.
    env: {
      TABLE_NAME: 'ImageProcessingTable',
      QUEUE_URL: 'https://sqs.eu-north-1.amazonaws.com/123456789012/ImageProcessingQueue',
      UPLOAD_BUCKET_NAME: 'image-upload-test',
      PROCESSED_BUCKET_NAME: 'image-processed-test',
      AWS_REGION: 'eu-north-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
    },
    coverage: {
      provider: 'v8',
      include: ['lambdas/**', 'lib/**', 'types/**'],
    },
  },
});
