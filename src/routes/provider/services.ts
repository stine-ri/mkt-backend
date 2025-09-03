import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';
import { and, eq, or, ilike, like, sql } from 'drizzle-orm';

const serviceRoutes = new Hono();

serviceRoutes.get('/api/services', async (c) => {
  try {
    const search = c.req.query('q');
    
    console.log('=== SERVICE SEARCH DEBUG ===');
    console.log('Search parameter received:', search);
    console.log('Search parameter type:', typeof search);
    
    // Check if search is actually provided and not empty
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      console.log('Processing search for term:', searchTerm);
      
      // Build the filtered query
      const result = await db.select().from(services).where(
        or(
          ilike(services.name, `%${searchTerm}%`),
          ilike(services.category, `%${searchTerm}%`),
          ilike(services.description, `%${searchTerm}%`)
        )
      );
      
      console.log('Filtered results count:', result.length);
      console.log('Filtered results sample:', result.slice(0, 3).map(r => ({ 
        id: r.id, 
        name: r.name, 
        category: r.category 
      })));
      
      // Return the filtered results (could be empty array if no matches)
      return c.json(result);
      
    } else {
      // No search parameter or empty search, return all services
      console.log('No valid search parameter, returning all services');
      const result = await db.select().from(services);
      console.log('All services count:', result.length);
      return c.json(result);
    }
    
  } catch (err) {
    console.error('=== SERVICE SEARCH ERROR ===');
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