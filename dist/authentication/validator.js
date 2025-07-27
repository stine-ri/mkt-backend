import { z } from 'zod';
export const registerUserSchema = z.object({
    full_name: z.string(),
    email: z.string().email(),
    contact_phone: z.string(),
    address: z.string(),
    role: z.string().default("user"),
    password: z.string(),
});
export const loginUserSchema = z.object({
    email: z.string(),
    password: z.string(),
});
