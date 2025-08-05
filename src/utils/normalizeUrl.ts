// utils/normalizeUrl.ts
export function normalizeUrl(path?: string | null): string | null {
  if (!path) return null;
  
  // Handle absolute URLs and data URIs
  if (path.startsWith('http') || path.startsWith('data:')) return path;
  
  // Ensure consistent path format
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  // Remove any duplicate uploads segments
  const normalizedPath = cleanPath.replace(/^\/?uploads\//, '/uploads/');
  
  const baseURL = process.env.BASE_URL || 'https://mkt-backend-sz2s.onrender.com';
  return `${baseURL}${normalizedPath}`;
}