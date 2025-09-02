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
        // Check if user already exists
        const existingUser = await db.query.users.findFirst({
            where: eq(users.email, user.email),
            columns: { id: true, email: true }
        });

        if (existingUser) {
            throw new Error("User with this email already exists");
        }

        // Insert into Users table first
        createdUser = await db.insert(users).values({
            full_name: user.full_name,
            email: user.email,
            contact_phone: user.contact_phone,
            address: user.address,
            role: user.role,
            created_at: new Date(),
            updated_at: new Date()
        }).returning({ 
            id: users.id,
            email: users.email,
            role: users.role,
            full_name: users.full_name
        });

        if (!createdUser[0]?.id) {
            throw new Error("Failed to create user in users table");
        }

        console.log('User created with ID:', createdUser[0].id);

        // Insert into Authentication table
        const authRecord = await db.insert(Authentication).values({
            user_id: createdUser[0].id,
            password: user.password,
            role: user.role,
            email: user.email, // Ensure email consistency
            created_at: new Date(),
            updated_at: new Date()
        }).returning({ user_id: Authentication.user_id });

        if (!authRecord[0]?.user_id) {
            throw new Error("Failed to create authentication record");
        }

        console.log('Authentication record created for user_id:', authRecord[0].user_id);

        return createdUser[0];
    } catch (error: any) {
        console.error("Error creating user:", error);
        
        // Clean up if user was created but auth failed
        if (createdUser?.[0]?.id) {
            try {
                await db.delete(users).where(eq(users.id, createdUser[0].id));
                console.log('Cleaned up user record after auth failure');
            } catch (cleanupError) {
                console.error('Failed to cleanup user record:', cleanupError);
            }
        }
        
        // Re-throw the original error
        throw error;
    }
};

export const userLoginService = async (credentials: { email: string }): Promise<AuthUserResponse | null> => {
    try {
        console.log('Login service: Attempting login for email:', credentials.email);
        
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
            console.log('Login service: User not found in users table');
            return null;
        }

        console.log('Login service: User found with ID:', user.id);

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
            console.log('Login service: Authentication record not found or no password set for user_id:', user.id);
            
            // Check if there's an auth record with mismatched email
            const authByEmail = await db.query.Authentication.findFirst({
                columns: {
                    email: true,
                    role: true,
                    password: true,
                    user_id: true
                },
                where: eq(Authentication.email, credentials.email)
            });

            if (authByEmail) {
                console.log('Login service: Found auth record by email but user_id mismatch. Fixing...');
                // Update the authentication record to match the correct user_id
                try {
                    await db.update(Authentication)
                        .set({ user_id: user.id })
                        .where(eq(Authentication.email, credentials.email));
                    
                    console.log('Login service: Fixed user_id mismatch in authentication table');
                    return {
                        email: user.email,
                        role: user.role as 'admin' | 'service_provider' | 'client' | 'product_seller',
                        password: authByEmail.password ?? "",
                        user: {
                            id: user.id,
                            full_name: user.full_name,
                            contact_phone: user.contact_phone ?? null,
                            address: user.address ?? null
                        }
                    };
                } catch (fixError) {
                    console.error('Login service: Failed to fix user_id mismatch:', fixError);
                }
            }
            
            return null;
        }

        console.log('Login service: Authentication record found');

        // Ensure data consistency between tables
        if (authResult.email !== user.email || authResult.role !== user.role) {
            console.log('Login service: Data inconsistency detected, fixing...');
            try {
                await db.update(Authentication)
                    .set({ 
                        email: user.email, 
                        role: user.role,
                        updated_at: new Date()
                    })
                    .where(eq(Authentication.user_id, user.id));
                console.log('Login service: Fixed data inconsistency');
            } catch (updateError) {
                console.error('Login service: Failed to fix data inconsistency:', updateError);
            }
        }

        return {
            email: user.email, // Use email from users table for consistency
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

// Add a utility function to check and fix data consistency
export const validateUserConsistency = async (): Promise<void> => {
    try {
        console.log('Validating user data consistency...');
        
        // Find users with inconsistent data
        const inconsistentUsers = await db.execute(`
            SELECT u.id, u.email as user_email, u.role as user_role, 
                   a.email as auth_email, a.role as auth_role, a.user_id
            FROM users u
            LEFT JOIN authentication a ON u.id = a.user_id
            WHERE u.email != a.email OR u.role != a.role OR a.user_id IS NULL
        `);

        if (inconsistentUsers.rows && inconsistentUsers.rows.length > 0) {
            console.log(`Found ${inconsistentUsers.rows.length} inconsistent user records`);
            
            for (const row of inconsistentUsers.rows) {
                const userData = row as any;
                
                if (!userData.user_id) {
                    // Missing auth record - this shouldn't happen in normal flow
                    console.log(`Missing auth record for user ${userData.id}`);
                    continue;
                }
                
                // Fix inconsistent data
                await db.update(Authentication)
                    .set({
                        email: userData.user_email,
                        role: userData.user_role,
                        updated_at: new Date()
                    })
                    .where(eq(Authentication.user_id, userData.id));
                
                console.log(`Fixed inconsistency for user ${userData.id}`);
            }
        } else {
            console.log('No data inconsistencies found');
        }
    } catch (error) {
        console.error('Error validating user consistency:', error);
    }
};