// utils/filestorage.ts
import fs from 'fs/promises';
import path from 'path';
import { env } from 'hono/adapter';
import type { Context } from 'hono';

export async function uploadFile(file: File, userPath: string, c: Context): Promise<string> {
  // Validate input
  if (!file || !userPath) {
    throw new Error('Invalid file or user path');
  }

  // Create safe filename
  const timestamp = Date.now();
  const originalName = path.parse(file.name).name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const extension = path.extname(file.name).toLowerCase();
  const fileName = `${timestamp}-${originalName}${extension}`;

  // Define paths
  const serverPath = `uploads/${userPath}`;
  const publicPath = `/uploads/${userPath}/${fileName}`;
  const uploadDir = path.join(process.cwd(), serverPath);
  const fullFilePath = path.join(uploadDir, fileName);

  // Create directory
  await fs.mkdir(uploadDir, { recursive: true });

  // Write file
  await fs.writeFile(fullFilePath, Buffer.from(await file.arrayBuffer()));

  // Verify write
  try {
    await fs.access(fullFilePath);
    return publicPath;
  } catch (error) {
    console.error('File upload verification failed:', error);
    throw new Error('Failed to verify file upload');
  }
}

export async function deleteFile(fileUrl: string): Promise<void> {
  if (!fileUrl) return;

  try {
    const relativePath = fileUrl.startsWith('/uploads/') 
      ? fileUrl.substring(1)
      : fileUrl.replace(/^\/?uploads\//, 'uploads/');
    
    await fs.unlink(path.join(process.cwd(), relativePath));
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}

// For cloud storage integration
interface StorageService {
  upload(file: File, path: string): Promise<string>;
  delete(url: string): Promise<void>;
}

// Example S3 implementation stub
class S3Storage implements StorageService {
  async upload(file: File, path: string): Promise<string> {
    // Implement actual S3 upload
    return `https://your-bucket.s3.amazonaws.com/${path}/${file.name}`;
  }

  async delete(url: string): Promise<void> {
    // Implement S3 deletion
  }
}