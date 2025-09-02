import { Authentication, users } from "../drizzle/schema.js";
import db from "../drizzle/db.js";
import { eq } from "drizzle-orm";

interface AuthUserResponse {
    email: string;
    role: 'admin' | 'service_provider' | 'client' | 'product_seller';
    password: string;
    user: {
        id: number;
        full_name: string;
        contact_phone: string | null;
        address: string | null;
    };
}

export const createAuthUserService = async (user: {
    full_name: string;
    email: string;
    contact_phone: string;
    address: string;
    role: 'admin' | 'service_provider' | 'client' | 'product_seller';
    password: string;
}): Promise<{
    id: number;
    email: string;
    role: 'admin' | 'service_provider' | 'client' | 'product_seller';
    full_name: string;
} | null> => {
    let createdUser;
    
    try {
        // Insert into Users table
        createdUser = await db.insert(users).values({
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

        // Insert into Auth table
        await db.insert(Authentication).values({
            user_id: createdUser[0].id,
            password: user.password,
            role: user.role,
            email: user.email
        });

        return createdUser[0];
    } catch (error) {
        console.error("Error creating user:", error);
        
        // Clean up if user was created but auth failed
        if (createdUser?.[0]?.id) {
            await db.delete(users).where(eq(users.id, createdUser[0].id));
        }
        
        return null;
    }
};

export const userLoginService = async (credentials: { email: string }): Promise<AuthUserResponse | null> => {
    try {
        console.log('Login attempt for email:', credentials.email);
        
        // First, try to find the user in the users table
        const user = await db.query.users.findFirst({
            where: eq(users.email, credentials.email),
            columns: {
                id: true, // This maps to the user_id column in DB
                email: true,
                full_name: true,
                contact_phone: true,
                address: true,
                role: true
            }
        });

        if (!user) {
            console.log('User not found in users table');
            return null;
        }

        console.log('User found with ID:', user.id);

        // Now find the authentication record using the user.id (which maps to user_id column)
        const authResult = await db.query.Authentication.findFirst({
            columns: {
                email: true,
                role: true,
                password: true,
                user_id: true
            },
            where: eq(Authentication.user_id, user.id), // user.id maps to the user_id column
        });

        if (!authResult?.password) {
            console.log('Authentication record not found or no password set for user_id:', user.id);
            return null;
        }

        console.log('Authentication record found');

        return {
            email: user.email, // Use email from users table
            role: user.role as 'admin' | 'service_provider' | 'client' | 'product_seller',
            password: authResult.password,
            user: {
                id: user.id,
                full_name: user.full_name,
                contact_phone: user.contact_phone ?? null,
                address: user.address ?? null
            }
        };
    } catch (error) {
        console.error('Login service error:', error);
        return null;
    }
};