import { env } from 'hono/adapter';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs/promises';
import type { Context } from 'hono';

// AWS S3 Upload
export async function uploadFile(file: File, path: string, c: Context): Promise<string> {
  const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_BUCKET_NAME } = env(c);

  const s3 = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  });

  const uploadParams = {
    Bucket: AWS_BUCKET_NAME,
    Key: `${path}/${file.name}`,
    Body: file.stream(),
    ContentType: file.type,
  };

  await s3.send(new PutObjectCommand(uploadParams));

  return `https://${AWS_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${uploadParams.Key}`;
}

// Local file upload
export async function uploadFileLocal(file: File, path: string): Promise<string> {
  const uploadDir = `./uploads/${path}`;
  const fileName = `${Date.now()}-${file.name}`;
  const filePath = `${uploadDir}/${fileName}`;

  await fs.mkdir(uploadDir, { recursive: true });

  const fileBuffer = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(fileBuffer));

  return `/uploads/${path}/${fileName}`;
}
