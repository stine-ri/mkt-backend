// src/routes/serviceRoutes.ts
import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';
import { ilike,or} from 'drizzle-orm';
const serviceRoutes = new Hono();

serviceRoutes.get('/api/services', async (c) => {
  try {
    const search = c.req.query('search');
    
    const baseQuery = db.select().from(services);
    
    const query = search 
      ? baseQuery.where(
          or(
            ilike(services.name, `%${search}%`),
            ilike(services.category, `%${search}%`),
            ilike(services.description, `%${search}%`)
          )
        )
      : baseQuery;
    
    const result = await query;
    return c.json(result);
  } catch (err) {
    console.error('Error fetching services:', err);
    return c.json({ error: 'Failed to fetch services' }, 500);
  }
});

export default serviceRoutes;
