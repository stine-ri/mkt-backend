 
 import { Hono } from 'hono';
 import { zValidator } from '@hono/zod-validator';
 import { registerUser, loginUser,getUserFromResetToken,resetPassword } from './auth.controller.js';
 import { registerUserSchema, loginUserSchema } from './validator.js';
  
 export const authRouter = new Hono();
  
 authRouter.post('/register', zValidator('json', registerUserSchema, (result, c) => {
   if (!result.success) {
     return c.json(result.error, 400);
   }
 }), registerUser);
  
 authRouter.post('/login', zValidator('json', loginUserSchema, (result, c) => {
   if (!result.success) {
     return c.json(result.error, 400);
   }
 }), loginUser);
  
 // Add these to your existing auth routes
authRouter.post('/api/auth/get-user-from-token', getUserFromResetToken);
authRouter.post('/api/auth/reset-password', resetPassword);