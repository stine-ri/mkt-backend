import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';
import { sql } from 'drizzle-orm';

const serviceRoutes = new Hono();

serviceRoutes.get('/api/services', async (c) => {
  try {
    const search = c.req.query('q');
    
    console.log('=== SERVICE SEARCH ===');
    console.log('Search parameter:', search);
    
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      console.log('Searching for:', searchTerm);
      
      // FIXED: Use proper parameter binding with drizzle-orm
      const result = await db.execute(sql`
        SELECT * FROM services 
        WHERE 
          LOWER(name) LIKE LOWER('%' || ${searchTerm} || '%') OR
          LOWER(category) LIKE LOWER('%' || ${searchTerm} || '%') OR
          LOWER(description) LIKE LOWER('%' || ${searchTerm} || '%')
      `);
      
      console.log('Search results:', result.rows.length);
      console.log('Found services:', result.rows.map(r => r.name));
      
      return c.json(result.rows);
      
    } else {
      console.log('No search term - returning all services');
      // Use the same query format for consistency
      const result = await db.execute(sql`SELECT * FROM services`);
      return c.json(result.rows);
    }
    
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Failed to fetch services' }, 500);
  }
});

export default serviceRoutes;