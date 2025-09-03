import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';
import { ilike, or } from 'drizzle-orm';

const serviceRoutes = new Hono();
serviceRoutes.get('/services/debug-test', async (c) => {
  console.log('=== DEBUG TEST ROUTE EXECUTING ===');
  console.log('This proves the code is updated');
  
  return c.json({
    message: 'Debug test successful!',
    timestamp: new Date().toISOString(),
    codeVersion: 'updated-' + Date.now()
  });
});
serviceRoutes.get('/services', async (c) => {
  try {
    const search = c.req.query('q');
    
    console.log('=== SERVICE SEARCH DEBUG ===');
    console.log('Raw search parameter:', search);
    console.log('Search parameter type:', typeof search);
    console.log('Search parameter length:', search?.length);
    
    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      console.log('Formatted search term:', searchTerm);
      
      // First, let's see all services to compare
      const allServices = await db.select().from(services);
      console.log('All services in DB:', allServices.map(s => ({ id: s.id, name: s.name, category: s.category })));
      
      // Now try the search
      const result = await db.select()
        .from(services)
        .where(
          or(
            ilike(services.name, searchTerm),
            ilike(services.category, searchTerm),
            ilike(services.description, searchTerm)
          )
        );
      
      console.log('Search results count:', result.length);
      console.log('Search results:', result.map(r => ({ id: r.id, name: r.name, category: r.category })));
      
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
serviceRoutes.get('/services/debug-schema', async (c) => {
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