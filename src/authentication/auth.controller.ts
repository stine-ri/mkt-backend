
import "dotenv/config";
import { Context } from "hono";
import { createAuthUserService, userLoginService } from "./auth.service";
import * as bycrpt from "bcrypt";
import { sign } from "hono/jwt";
import { users } from "../drizzle/schema";
 import type { JwtPayload } from '../types/context';
export const registerUser = async (c: Context) => {
    try {
 
        console.log(await c.req.json())
        const user = await c.req.json();
        const pass = user.password;
        const hashedPassword = await bycrpt.hash(pass, 10);
        user.password = hashedPassword;
        const createdUser = await createAuthUserService(user);
        if (!createdUser) return c.text("User exit do you want to login?", 404);
        return c.json({ msg: createdUser }, 201);
 
    } catch (error: any) {
        return c.json({ error: error?.message }, 400)
    }
 
}
 
export const loginUser = async (c: Context) => {
    try {
        const credentials = await c.req.json();
        const userAuth = await userLoginService(credentials);
        
        if (!userAuth) {
            return c.json({ error: "User not found" }, 404);
        }

        const passwordMatch = await bycrpt.compare(credentials.password, userAuth.password);
        if (!passwordMatch) {
            return c.json({ error: "Invalid credentials" }, 401);
        }

        // Create payload that exactly matches JwtPayload type
        const payload: JwtPayload = {
            id: userAuth.user.id.toString(),
            email: userAuth.email,
            role: userAuth.role
        };

        console.log("Token payload:", payload); // For debugging

        const token = await sign(payload, process.env.JWT_SECRET as string);
        
        return c.json({ 
            token, 
            user: { 
                userId: userAuth.user.id,
                email: userAuth.email,
                role: userAuth.role,
                full_name: userAuth.user.full_name,
                contact_phone: userAuth.user.contact_phone ?? null,
                address: userAuth.user.address ?? null
            } 
        }, 200);
    } catch (error: any) {
        console.error("Login error:", error);
        return c.json({ error: error?.message || "Login failed" }, 400);
    }
}
 
 
 