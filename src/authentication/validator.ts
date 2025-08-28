import { z } from 'zod';

export const registerUserSchema = z.object({
  full_name: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email format"),
  contact_phone: z.string().min(1, "Phone number is required"),
  address: z.string().optional(),
  role: z.enum(['admin', 'service_provider', 'client', 'product_seller']),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const loginUserSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});