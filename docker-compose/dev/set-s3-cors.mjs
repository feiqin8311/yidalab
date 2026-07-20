/**
 * Apply browser-upload CORS to the local rustfs/minio `lobe` bucket.
 * Usage (from repo root): node docker-compose/dev/set-s3-cors.mjs
 */
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
const bucket = process.env.S3_BUCKET || 'lobe';
const accessKeyId = process.env.S3_ACCESS_KEY_ID || 'admin';
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || 'change_this_password_on_production';

const client = new S3Client({
  credentials: { accessKeyId, secretAccessKey },
  endpoint,
  forcePathStyle: true,
  region: process.env.S3_REGION || 'us-east-1',
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ['*'],
          AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
          AllowedOrigins: ['*'],
          ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type', 'x-amz-request-id'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

console.info(`CORS applied on ${endpoint}/${bucket}`);
