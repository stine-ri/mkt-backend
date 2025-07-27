import {Authentication, users,TIAuthentication, TIUsers  } from "../drizzle/schema";
import db from "../drizzle/db";
import { sql } from "drizzle-orm";
 
 
export const createAuthUserService = async (user:  TIUsers & { password: string }): Promise<string | null> => {
    try {
        // Insert into Users table
        const createdUser = await db.insert(users).values({
          full_name: user.full_name,
          email: user.email,
          contact_phone: user.contact_phone,
          address: user.address,
          role: user.role,
    
        }).returning({ id: users.id});
 
        // Ensure the user was created and the id is retrieved
        if (!createdUser || !createdUser[0] || !createdUser[0].id) {
            throw new Error("Failed to create user in users table");
        }
 
        const userId = createdUser[0].id;
 
        // Insert into Auth table
        await db.insert(Authentication).values({
            user_id: userId,
            password: user.password,
            role: user.role === 'client' || user.role === 'admin' || user.role === 'service_provider' ? user.role : 'client',
            email: user.email
        });
 
        return "User created successfully";
    } catch (error) {
        console.error("Error creating user in the database:", error);
        return null;
    }
};
 
 
export const userLoginService = async (user: TIAuthentication): Promise<{
    email: string;
    role: 'admin' | 'service_provider' | 'client'; // Strictly typed
    password: string;
    user: {
        id: number;
        full_name: string;
        contact_phone: string | null;
        address: string | null;
    };
} | null> => {
    const { email } = user;
    
    try {
        const result = await db.query.Authentication.findFirst({
            columns: {
                email: true,
                role: true,
                password: true
            }, 
            where: sql`${Authentication.email} = ${email}`,
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

        if (!result || !result.email || !result.role || !result.password || !result.user?.id) {
            return null;
        }

        // Ensure role is one of the allowed values
        if (!['admin', 'service_provider', 'client'].includes(result.role)) {
            return null;
        }

        return {
            email: result.email,
            role: result.role as 'admin' | 'service_provider' | 'client',
            password: result.password,
            user: {
                id: result.user.id,
                full_name: result.user.full_name,
                contact_phone: result.user.contact_phone ?? null,
                address: result.user.address ?? null
            }
        };
    } catch (error) {
        console.error('Error in userLoginService:', error);
        return null;
    }
}
 