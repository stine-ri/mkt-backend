import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { listUsers, getUser, createUser, updateUser, deleteUser } from "./users.controller.js";
import { usersSchema } from "./validator";
import { adminRoleAuth } from "../middleware/bearAuth";
import { db } from "../drizzle/db"; // Your Drizzle DB connection
import { users } from "../drizzle/schema";
import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
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


