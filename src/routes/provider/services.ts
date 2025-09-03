import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';
import { ilike, or } from 'drizzle-orm';

const serviceRoutes = new Hono();

serviceRoutes.get('/api/services', async (c) => {
  try {
    const search = c.req.query('q');
    
    console.log('=== SERVICE SEARCH ===');
    console.log('Search parameter:', search);
    
    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      console.log('Searching for:', searchTerm);
      
      // Use Drizzle ORM's query builder with correct field names
      const result = await db.select()
        .from(services)
        .where(
          or(
            ilike(services.name, searchTerm),
            ilike(services.category, searchTerm),
            ilike(services.description, searchTerm)
          )
        );
      
      console.log('Search results:', result.length);
      console.log('Found services:', result.map(r => r.name));
      
      return c.json(result);
      
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

// Debug endpoint to test the schema
serviceRoutes.get('/api/services/debug-schema', async (c) => {
  try {
    // Test a simple query to see the actual schema
    const testResult = await db.select().from(services).limit(1);
    
    return c.json({
      success: true,
      schemaSample: testResult[0],
      fields: Object.keys(testResult[0] || {}),
      totalServices: (await db.select().from(services)).length
    });
    
  } catch (err) {
    const errorMessage = typeof err === 'object' && err !== null && 'message' in err ? (err as { message: string }).message : String(err);
    return c.json({ error: errorMessage }, 500);
  }
});

export default serviceRoutes;