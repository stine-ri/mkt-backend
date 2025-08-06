// utils/filestorage.ts
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Context } from 'hono';

// Supported image MIME types
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
];

// Maximum file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function uploadFile(
  file: File, 
  userPath: string, 
  c: Context
): Promise<string> {
  try {
    // Validate input
    if (!file || !userPath) {
      throw new Error('Invalid file or user path');
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      throw new Error(`Unsupported file type: ${file.type}`);
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (max ${MAX_FILE_SIZE/1024/1024}MB)`);
    }

    // Create safe filename
    const originalName = path.parse(file.name).name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const extension = path.extname(file.name).toLowerCase();
    const fileName = `${randomUUID()}-${originalName}${extension}`;

    // Define paths
    const serverPath = path.join('uploads', userPath);
    const publicPath = `/uploads/${userPath}/${fileName}`;
    const fullFilePath = path.join(process.cwd(), serverPath, fileName);

    // Create directory with proper permissions
    await fs.mkdir(path.dirname(fullFilePath), { 
      recursive: true,
      mode: 0o755 // rwxr-xr-x
    });

    // Write file with proper permissions
    const buffer = await file.arrayBuffer();
    await fs.writeFile(fullFilePath, Buffer.from(buffer));
    await fs.chmod(fullFilePath, 0o644); // rw-r--r--

    return publicPath;
  } catch (error) {
    console.error('File upload failed:', error);
    throw error;
  }
}

export async function deleteFile(fileUrl: string): Promise<void> {
  if (!fileUrl) return;

  try {
    // Convert URL to filesystem path
    const relativePath = fileUrl.startsWith('/uploads/') 
      ? fileUrl.substring(1)
      : fileUrl.replace(/^\/?uploads\//, 'uploads/');
    
    const fullPath = path.join(process.cwd(), relativePath);
    
    // Check if file exists before deleting
    try {
      await fs.access(fullPath);
      await fs.unlink(fullPath);
      
      // Optional: Clean up empty directories
      const dirPath = path.dirname(fullPath);
      const files = await fs.readdir(dirPath);
      if (files.length === 0) {
        await fs.rmdir(dirPath);
      }
    }  catch (err: unknown) {
  if (err instanceof Error && (err as any).code !== 'ENOENT') {
    throw err;
  }
}

  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}