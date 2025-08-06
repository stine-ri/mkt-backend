import { Authentication, users, TIAuthentication, TIUsers } from "../drizzle/schema.js";
import db from "../drizzle/db.js";
import { eq } from "drizzle-orm";

interface AuthUserResponse {
    email: string;
    role: 'admin' | 'service_provider' | 'client';
    password: string;
    user: {
        id: number;
        full_name: string;
        contact_phone: string | null;
        address: string | null;
    };
}

export const createAuthUserService = async (user: TIUsers & { password: string }): Promise<{
    id: number;
    email: string;
    role: 'admin' | 'service_provider' | 'client';
    full_name: string;
} | null> => {
    try {
        return await db.transaction(async (tx) => {
            // Insert into Users table
            const createdUser = await tx.insert(users).values({
                full_name: user.full_name,
                email: user.email,
                contact_phone: user.contact_phone,
                address: user.address,
                role: user.role,
            }).returning({ 
                id: users.id,
                email: users.email,
                role: users.role,
                full_name: users.full_name
            });

            if (!createdUser[0]?.id) {
                throw new Error("Failed to create user in users table");
            }

            // Insert into Auth table - ensure non-null values
            await tx.insert(Authentication).values({
                user_id: createdUser[0].id,
                password: user.password, // password is guaranteed to be string from input type
                role: user.role as 'admin' | 'service_provider' | 'client',
                email: user.email // email is guaranteed to be string from schema
            });

            return createdUser[0];
        });
    } catch (error) {
        console.error("Error creating user:", error);
        return null;
    }
};

export const userLoginService = async (credentials: { email: string }): Promise<AuthUserResponse | null> => {
    try {
        const result = await db.query.Authentication.findFirst({
            columns: {
                email: true,
                role: true,
                password: true
            }, 
            where: eq(Authentication.email, credentials.email),
            with: {
                user: {
                    columns: {
                        id: true,
                        full_name: true,
                        contact_phone: true,
                        address: true
                    }
                }
            }
        });

        if (!result?.email || !result.role || !result.password || !result.user?.id) {
            return null;
        }

        // Type assertion since we've already validated the role
        const validRole = result.role as 'admin' | 'service_provider' | 'client';

        return {
            email: result.email,
            role: validRole,
            password: result.password,
            user: {
                id: result.user.id,
                full_name: result.user.full_name,
                contact_phone: result.user.contact_phone ?? null,
                address: result.user.address ?? null
            }
        };
    } catch (error) {
        console.error('Login error:', error);
        return null;
    }
};