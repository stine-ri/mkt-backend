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
    '/api/services',
    '/api/colleges',
    '/health',  // Health check route
    // Add more public route paths here
  ];

  const path = c.req.path;
  console.log('Auth middleware - checking path:', path);
  console.log('Public routes:', publicRoutes);
  
  const isPublic = publicRoutes.some(publicRoute => {
    const matches = path.startsWith(publicRoute);
    console.log(`Checking if '${path}' starts with '${publicRoute}': ${matches}`);
    return matches;
  });
  
  console.log('Is path public?:', isPublic);

  const token = c.req.header("Authorization")?.split(" ")[1];
  console.log('Token present:', !!token);

  if (!token && !isPublic) {
    console.log('No token and not public route - returning 401');
    return c.json({ error: "Token not provided" }, 401);
  }

  if (token) {
    try {
      const decoded = await verify(token, process.env.JWT_SECRET as string) as JwtPayload;

      if (!decoded || !decoded.id || !decoded.role) {
        console.log('Invalid token payload - returning 401');
        return c.json({ error: "Invalid token payload" }, 401);
      }

      c.set("user", {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
      });
      console.log('Token verified successfully');
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