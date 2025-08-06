
import "dotenv/config";
import  { Context } from "hono";
import { createAuthUserService, userLoginService } from "./auth.service.js";
import * as bycrpt from "bcrypt";
import { sign } from "hono/jwt";
import { providers} from "../drizzle/schema.js";
import db from "../drizzle/db.js";
import { sql } from 'drizzle-orm';
 import type { JwtPayload } from '../types/context.js';
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

    // ✅ If the user is a service_provider, look up their providerId
    let providerId: number | null = null;
    if (userAuth.role === 'service_provider') {
      const provider = await db.query.providers.findFirst({
        where: sql`${providers.userId} = ${userAuth.user.id}`,
        columns: {
          id: true,
        },
      });

      providerId = provider?.id ?? null;
    }

    // ✅ Now include providerId in the JWT
    const payload: JwtPayload = {
      id: userAuth.user.id.toString(),
      email: userAuth.email,
      role: userAuth.role,
      providerId, // ✅ This fixes the 400 error
    };

    const token = await sign(payload, process.env.JWT_SECRET as string);

    return c.json({
      token,
      user: {
        userId: userAuth.user.id,
        email: userAuth.email,
        role: userAuth.role,
        full_name: userAuth.user.full_name,
        contact_phone: userAuth.user.contact_phone ?? null,
        address: userAuth.user.address ?? null,
        providerId // Optionally send it to frontend too
      }
    }, 200);
  } catch (error: any) {
    console.error("Login error:", error);
    return c.json({ error: error?.message || "Login failed" }, 400);
  }
}
 
 
 