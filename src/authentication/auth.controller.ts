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
        const hashedPassword = await bcrypt.hash(user.password, 10);
        
        const createdUser = await createAuthUserService({
            ...user,
            password: hashedPassword
        });

        if (!createdUser) {
            return c.json({ error: "User creation failed" }, 400);
        }

        // Create provider record for service providers
        if (user.role === 'service_provider') {
            try {
                await db.insert(providers).values({
                    userId: createdUser.id,
                    firstName: user.firstName || createdUser.full_name.split(' ')[0] || 'Provider',
                    lastName: user.lastName || createdUser.full_name.split(' ').slice(1).join(' ') || 'User',
                    phoneNumber: user.phoneNumber || user.contact_phone || '+0000000000',
                    status: 'active',
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
            } catch (error) {
                console.error("Provider creation failed:", error);
                // Continue even if provider creation fails
            }
        }

        return c.json({
            message: "User registered successfully",
            user: {
                id: createdUser.id,
                email: createdUser.email,
                role: createdUser.role,
                full_name: createdUser.full_name
            }
        }, 201);

    } catch (error: any) {
        return c.json({ error: error?.message }, 400);
    }
};

export const loginUser = async (c: Context) => {
    try {
        const credentials = await c.req.json();
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
        if (authResponse.role === 'service_provider') {
            const provider = await db.query.providers.findFirst({
                where: eq(providers.userId, authResponse.user.id),
                columns: { id: true },
            });
            providerId = provider?.id ?? null;
        }
console.log('✔ Provider ID resolved:', providerId);
        // Create JWT payload
        const payload: JwtPayload = {
            id: authResponse.user.id.toString(),
            email: authResponse.email,
            role: authResponse.role,
           ...(providerId !== null ? { providerId } : {}),
        };
console.log('🔐 JWT Payload:', payload);
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
        return c.json({ error: error?.message || "Login failed" }, 400);
    }
};