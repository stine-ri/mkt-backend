import { v2 as cloudinary } from 'cloudinary';
import { env } from 'hono/adapter';
import type { Context } from 'hono';

// Configure Cloudinary with your credentials
export function configureCloudinary(c: Context) {
  const { 
    CLOUDINARY_CLOUD_NAME, 
    CLOUDINARY_API_KEY, 
    CLOUDINARY_API_SECRET 
  } = env(c);
  
  cloudinary.config({ 
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true // Always use HTTPS
  });
}

// Upload function
export async function uploadToCloudinary(
  file: File,          // The image file to upload
  folderPath: string,  // Where to store it in Cloudinary
  c: Context           // Hono context for env variables
): Promise<{ 
  url: string,         // Public URL of the uploaded image
  public_id: string    // Cloudinary's unique ID for the image
}> {
  // Set up configuration
  configureCloudinary(c);
  
  // Convert file to buffer
  const buffer = await file.arrayBuffer();
  
  return new Promise((resolve, reject) => {
    // Create upload stream
    const uploadStream = cloudinary.uploader.upload_stream(
      { 
        folder: folderPath,            // Organize images in folders
        resource_type: 'auto',         // Auto-detect image/video
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'] // Allowed formats
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error('Upload failed'));
          return;
        }
        resolve({
          url: result.secure_url,     // HTTPS URL
          public_id: result.public_id // Unique ID for deletion
        });
      }
    );
    
    // Convert buffer to Uint8Array and upload
    const array = new Uint8Array(buffer);
    uploadStream.end(array);
  });
}

// Delete function
export async function deleteFromCloudinary(
  publicId: string, // The Cloudinary ID of the image
  c: Context
): Promise<void> {
  configureCloudinary(c);
  
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Error deleting image:', error);
    throw error;
  }
}