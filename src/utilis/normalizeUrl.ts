// utils/normalizeUrl.ts
export function normalizeUrl(path?: string | null): string | null {
  if (!path) return null;
  
  // Already a full URL or data URI
  if (path.startsWith('http') || path.startsWith('data:')) return path;
  
  // Ensure consistent path format
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  // For local files, prepend base URL
  const baseURL = process.env.BASE_URL || 'https://mkt-backend-sz2s.onrender.com';
  
  // Special handling for uploads
  if (cleanPath.startsWith('/uploads/')) {
    return `${baseURL}${cleanPath}`;
  }
  
  return `${baseURL}${cleanPath}`;
}