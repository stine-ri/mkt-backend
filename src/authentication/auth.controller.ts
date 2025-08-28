import "dotenv/config";
import { Context } from "hono";
import { createAuthUserService, userLoginService } from "./auth.service.js";
import * as bcrypt from "bcrypt";
import { sign } from "hono/jwt";
import { providers } from "../drizzle/schema.js";
import db from "../drizzle/db.js";
import { eq } from 'drizzle-orm';
import type { JwtPayload } from '../types/context.js';

export const registerUser = async (c: Context) => {
    try {
        const user = await c.req.json();
        
        // Enhanced validation
        if (!user.email || !user.password || !user.full_name || !user.contact_phone) {
            return c.json({ 
                error: "Missing required fields",
                required: {
                    email: !user.email ? "Email is required" : null,
                    password: !user.password ? "Password is required" : null,
                    full_name: !user.full_name ? "Full name is required" : null,
                    contact_phone: !user.contact_phone ? "Phone number is required" : null
                }
            }, 400);
        }

        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
            return c.json({ error: "Invalid email format" }, 400);
        }

        // Validate password length
        if (user.password.length < 8) {
            return c.json({ error: "Password must be at least 8 characters" }, 400);
        }

        // Optional: Validate password confirmation if sent
        if (user.confirmPassword && user.password !== user.confirmPassword) {
            return c.json({ error: "Passwords do not match" }, 400);
        }

        const hashedPassword = await bcrypt.hash(user.password, 10);
        
        const createdUser = await createAuthUserService({
            ...user,
            password: hashedPassword
        });

        if (!createdUser) {
            return c.json({ error: "User creation failed" }, 400);
        }

        let providerId: number | null = null;
        
        // Create provider record only if role is service_provider
        if (user.role === 'service_provider' || user.role === 'product_seller') {
            try {
                const nameParts = createdUser.full_name.split(' ');
                const provider = await db.insert(providers).values({
                    userId: createdUser.id,
                    firstName: nameParts[0] || 'Provider',
                    lastName: nameParts.slice(1).join(' ') || 'User',
                    phoneNumber: user.contact_phone,
                    status: 'active',
                    createdAt: new Date(),
                    updatedAt: new Date()
                }).returning({ id: providers.id });
                
                providerId = provider[0]?.id || null;
            } catch (error) {
                console.error("Provider creation failed:", error);
                // Continue with user registration even if provider creation fails
            }
        }

        // Create JWT token for immediate login after registration
        const payload: JwtPayload = {
            id: createdUser.id.toString(),
            email: createdUser.email,
            role: createdUser.role as 'admin' | 'service_provider' | 'client',
            ...(providerId ? { providerId } : {})
        };

        const token = await sign(payload, process.env.JWT_SECRET as string);

        return c.json({
            message: "User registered successfully",
            token, // Include the token in response
            user: {
                id: createdUser.id,
                email: createdUser.email,
                role: createdUser.role,
                full_name: createdUser.full_name,
                contact_phone: user.contact_phone,
                address: user.address,
                providerId // Include providerId if exists
            }
        }, 201);

    } catch (error: any) {
        console.error("Registration error:", error);
        return c.json({ 
            error: error?.message || "Registration failed",
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }, 400);
    }
};
export const loginUser = async (c: Context) => {
    try {
        const credentials = await c.req.json();
        
        if (!credentials.email || !credentials.password) {
            return c.json({ error: "Email and password are required" }, 400);
        }

        const authResponse = await userLoginService(credentials);

        if (!authResponse) {
            return c.json({ error: "Invalid credentials" }, 401);
        }

        const passwordMatch = await bcrypt.compare(
            credentials.password, 
            authResponse.password
        );

        if (!passwordMatch) {
            return c.json({ error: "Invalid credentials" }, 401);
        }

        // Handle provider ID for service providers
        let providerId: number | null = null;
        if (authResponse.role === 'service_provider' || authResponse.role === 'product_seller') {
                const provider = await db.query.providers.findFirst({
                where: eq(providers.userId, authResponse.user.id),
                columns: { id: true },
                });
                 providerId = provider?.id ?? null;
        }

        // Create JWT payload
        const payload: JwtPayload = {
            id: authResponse.user.id.toString(),
            email: authResponse.email,
            role: authResponse.role,
            ...(providerId !== null ? { providerId } : {}),
        };

        const token = await sign(payload, process.env.JWT_SECRET as string);

        return c.json({
            token,
            user: {
                id: authResponse.user.id,
                email: authResponse.email,
                role: authResponse.role,
                full_name: authResponse.user.full_name,
                contact_phone: authResponse.user.contact_phone,
                address: authResponse.user.address,
                providerId
            }
        }, 200);

    } catch (error: any) {
        console.error("Login error:", error);
        return c.json({ 
            error: error?.message || "Login failed",
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }, 400);
    }
};