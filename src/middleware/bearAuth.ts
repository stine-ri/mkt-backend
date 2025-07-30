import "dotenv/config";
import { verify, sign } from "hono/jwt";
import type { Context, Next } from "hono";
import type { CustomContext } from "../types/context.js";
import type { JwtPayload } from '../types/context.js';

export const verifyToken = async (token: string, secret: string) => {
    try {
        const decoded = await verify(token, secret);
        return decoded as JwtPayload;
    } catch {
        return null;
    }
};

export const authMiddleware = async (c: Context<CustomContext>, next: Next) => {
  const publicRoutes = [
    '/public/all',
    '/public/',  // This will match /public/:id routes
    '/api/services',  // GET only - read access
    '/api/colleges',  // GET only - read access
    '/health',
    '/api/login',
    '/api/register',
    '/uploads/',  // Static file serving
  ];

  // Exact match routes (only these exact paths)
  const exactPublicRoutes = [
    '/',  // Root route only
  ];

  const path = c.req.path;
  console.log('Auth middleware - checking path:', path);
  console.log('Method:', c.req.method);
  
  // Check if route starts with any public route prefix
  const isPublicPrefix = publicRoutes.some(publicRoute => {
    const matches = path.startsWith(publicRoute);
    console.log(`Checking if '${path}' starts with '${publicRoute}': ${matches}`);
    return matches;
  });

  // Check if route is an exact match for public routes
  const isExactPublic = exactPublicRoutes.includes(path);
  
  const isPublic = isPublicPrefix || isExactPublic;
  console.log('Is path public?:', isPublic);

  const token = c.req.header("Authorization")?.split(" ")[1];
  console.log('Token present:', !!token);

  if (!token && !isPublic) {
    console.log('No token and not public route - returning 401');
    return c.json({ error: "Token not provided" }, 401);
  }

  if (token) {
    try {
      const decoded = await verify(process.env.JWT_SECRET as string, token) as JwtPayload;

      if (!decoded || !decoded.id || !decoded.role) {
        console.log('Invalid token payload - returning 401');
        if (!isPublic) {
          return c.json({ error: "Invalid token payload" }, 401);
        }
      } else {
        c.set("user", {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
        });
        console.log('Token verified successfully for user:', decoded.email);
      }
    } catch (error) {
      console.log('Token verification failed:', error);
      if (!isPublic) {
        return c.json({ error: "Invalid or expired token" }, 401);
      }
    }
  }

  console.log('Auth middleware - proceeding to next()');
  await next();
};

export const roleMiddleware = (requiredRole: JwtPayload['role']) => {
    return async (c: Context<CustomContext>, next: Next) => {
        const user = c.get('user');
        console.log(`Role middleware - required: ${requiredRole}, user role: ${user?.role}`);
        
        if (!user || user.role !== requiredRole) {
            console.log('Role check failed - returning 403');
            return c.json({ error: "Unauthorized" }, 403);
        }
        await next();
    };
};

export const adminRoleAuth = roleMiddleware("admin");
export const clientRoleAuth = roleMiddleware("client");
export const serviceProviderRoleAuth = roleMiddleware("service_provider");