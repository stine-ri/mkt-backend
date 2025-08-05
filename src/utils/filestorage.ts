// utils/filestorage.ts
import fs from 'fs/promises';
import path from 'path';
import { env } from 'hono/adapter';
import type { Context } from 'hono';

export async function uploadFile(file: File, userPath: string, c: Context): Promise<string> {
  // Validate input
  if (!file || !userPath) throw new Error('Invalid file or user path');

  // Create safe filename
  const timestamp = Date.now();
  const originalName = path.parse(file.name).name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const extension = path.extname(file.name).toLowerCase();
  const fileName = `${timestamp}-${originalName}${extension}`;

  // Define paths - CRITICAL FIX
  const serverPath = path.join('uploads', userPath); // "uploads/providers/8"
  const publicPath = `/uploads/${userPath}/${fileName}`; // "/uploads/providers/8/filename.jpg"
  const fullFilePath = path.join(process.cwd(), serverPath, fileName);

  // Create directory with proper permissions
  await fs.mkdir(path.dirname(fullFilePath), { 
    recursive: true,
    mode: 0o755 // rwxr-xr-x
  });

  // Write file with proper permissions
  await fs.writeFile(fullFilePath, Buffer.from(await file.arrayBuffer()));
  await fs.chmod(fullFilePath, 0o644); // rw-r--r--

  // Verify the file exists and is readable
  try {
    await fs.access(fullFilePath, fs.constants.R_OK);
    console.log('File successfully saved at:', fullFilePath);
    return publicPath;
  } catch (error) {
    console.error('File verification failed:', {
      error,
      fullFilePath,
      publicPath
    });
    throw new Error('Uploaded file cannot be accessed');
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