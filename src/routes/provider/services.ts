// src/routes/serviceRoutes.ts
import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';

const serviceRoutes = new Hono();

serviceRoutes.get('/api/services', async (c) => {
  try {
    const result = await db.select().from(services);
    return c.json(result);
  } catch (err) {
    console.error('Error fetching services:', err);
    return c.json({ error: 'Failed to fetch services' }, 500);
  }
});

export default serviceRoutes;
