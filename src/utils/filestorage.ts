// utils/filestorage.ts
import fs from 'fs/promises';
import path from 'path';
import { env } from 'hono/adapter';
import type { Context } from 'hono';

export async function uploadFile(file: File, userPath: string, c: Context): Promise<string> {
  // Create safe filename
  const timestamp = Date.now();
  const originalName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const fileName = `${timestamp}-${originalName}`;
  
  // Create upload directory
  const uploadDir = path.join(process.cwd(), 'uploads', userPath);
  await fs.mkdir(uploadDir, { recursive: true });
  
  // Save file
  const filePath = path.join(uploadDir, fileName);
  const fileBuffer = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(fileBuffer));
  
  // Return accessible URL
  return `/uploads/${userPath}/${fileName}`;
}