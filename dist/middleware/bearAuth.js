import "dotenv/config";
import { verify } from "hono/jwt";
export const verifyToken = async (token, secret) => {
    try {
        const decoded = await verify(token, secret);
        return decoded;
    }
    catch {
        return null;
    }
};
export const authMiddleware = async (c, next) => {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) {
        return c.json({ error: "Token not provided" }, 401);
    }
    try {
        console.log("Verifying token:", token); // Debug log
        const decoded = await verify(token, process.env.JWT_SECRET);
        console.log("Decoded token:", decoded); // Debug log
        if (!decoded || !decoded.id || !decoded.role) {
            console.log("Invalid payload structure:", decoded);
            return c.json({ error: "Invalid token payload" }, 401);
        }
        c.set("user", {
            id: decoded.id,
            email: decoded.email,
            role: decoded.role,
        });
        await next();
    }
    catch (error) {
        console.error("Token verification error:", error);
        return c.json({ error: "Invalid or expired token" }, 401);
    }
};
export const roleMiddleware = (requiredRole) => {
    return async (c, next) => {
        const user = c.get('user');
        if (!user || user.role !== requiredRole) {
            return c.json({ error: "Unauthorized" }, 403);
        }
        await next();
    };
};
export const adminRoleAuth = roleMiddleware("admin");
export const clientRoleAuth = roleMiddleware("client");
export const serviceProviderRoleAuth = roleMiddleware("service_provider");
