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
      
      // USE RAW SQL QUERY - This will definitely work
      const result = await db.execute(sql`
        SELECT * FROM services 
        WHERE 
          LOWER(name) LIKE LOWER('%' || ${searchTerm} || '%') OR
          LOWER(category) LIKE LOWER('%' || ${searchTerm} || '%') OR
          LOWER(description) LIKE LOWER('%' || ${searchTerm} || '%')
      `);
      
      console.log('Raw SQL results:', result.rows.length);
      
      return c.json(result.rows);
      
    } else {
      console.log('No search term - returning all services');
      const result = await db.select().from(services);
      return c.json(result);
    }
    
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Failed to fetch services' }, 500);
  }
});

// Test endpoint to verify the database has the right data
serviceRoutes.get('/api/services/debug', async (c) => {
  try {
    const allServices = await db.select().from(services);
    
    return c.json({
      totalServices: allServices.length,
      services: allServices.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        hasCleaning: (s.name?.toLowerCase().includes('cleaning') || 
                     s.category?.toLowerCase().includes('cleaning') ||
                     s.description?.toLowerCase().includes('cleaning'))
      }))
    });
    
  } catch (err) {
    console.error('Debug error:', err);
    return c.json({ error: 'Debug failed' }, 500);
  }
});

export default serviceRoutes;