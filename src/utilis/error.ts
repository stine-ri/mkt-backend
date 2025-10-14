// src/utils/errors.ts

// Define allowed status codes for Hono
type ValidStatusCode = 400 | 401 | 403 | 404 | 422 | 500;

export class RouteError extends Error {
  constructor(
    public message: string,
    public statusCode: ValidStatusCode = 500,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RouteError';
  }
}
export class FileUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileUploadError';
  }
}

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}