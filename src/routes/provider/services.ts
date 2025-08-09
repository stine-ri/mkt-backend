// src/routes/serviceRoutes.ts
import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';
import { and, eq, or, ilike, like, sql } from 'drizzle-orm';
const serviceRoutes = new Hono();

serviceRoutes.get('/api/services', async (c) => {
  try {
    const search = c.req.query('search');
    
    // Debug: Log the incoming search parameter
    console.log('Search parameter:', search);
    
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
    
    // Debug: Log the query results
    console.log('Query results:', result);
    
    return c.json(result);
  } catch (err) {
    if (err instanceof Error) {
      console.error('Detailed error:', {
        message: err.message,
        stack: err.stack,
        name: err.name
      });
      return c.json({ 
        error: 'Failed to fetch services',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      }, 500);
    } else {
      console.error('Unknown error:', err);
      return c.json({ error: 'Failed to fetch services' }, 500);
    }
  }
});
export default serviceRoutes;
