import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { listUsers, getUser, createUser, updateUser, deleteUser } from "./users.controller.js";
import { usersSchema } from "./validator.js";
import { adminRoleAuth } from "../middleware/bearAuth.js";
import { db } from "../drizzle/db.js"; // Your Drizzle DB connection
import { users } from "../drizzle/schema.js";
import nodemailer from "nodemailer";
import { eq , inArray } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config();

export const userRouter = new Hono();

// ✅ Get all users
userRouter.get("/users", listUsers);

// ✅ Get a single user (e.g., /api/users/1)
userRouter.get("/users/:id", getUser);

// ✅ Create a user
userRouter.post(
  "/users",
  zValidator("json", usersSchema, (result, c) => {
    if (!result.success) {
      return c.json(result.error, 400);
    }
  }),
  createUser
);

// ✅ Update a user
userRouter.put("/users/:id", updateUser);

// ✅ Delete a user
userRouter.delete("/users/:id", deleteUser);

// ✅ Configure Nodemailer
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  secure: true, // Ensure SSL/TLS
  tls: {
    rejectUnauthorized: false, // Consider for development, not recommended for production
  },
});


// ✅ Bulk delete users
userRouter.post('/users/bulk-delete', async (c) => {
  try {
    const body = await c.req.json();
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ message: 'No user IDs provided' }, 400);
    }

    // Delete users from database
   await db.delete(users).where(
  ids.length === 1
    ? eq(users.id, ids[0])
    : inArray(users.id, ids)
);

    return c.json({ message: 'Users deleted successfully' }, 200);
  } catch (error) {
    console.error('Error in bulk-delete route:', error);
    return c.json({ message: 'Failed to delete users' }, 500);
  }
});
