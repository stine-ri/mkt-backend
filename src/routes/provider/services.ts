import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';
import { ilike, or, eq } from 'drizzle-orm';

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
    console.log('Search parameter:', search);
    
    if (search && search.trim() !== '') {
      const searchTerm = search.trim().toLowerCase();
      console.log('Searching for:', searchTerm);
      
      // Test 1: Try exact match first
      console.log('--- Test 1: Exact match ---');
      const exactResult = await db.select()
        .from(services)
        .where(ilike(services.name, 'Plumbing'));
      console.log('Exact "Plumbing" results:', exactResult.length);
      
      // Test 2: Try with wildcards
      console.log('--- Test 2: Wildcard match ---');
      const wildcardResult = await db.select()
        .from(services)
        .where(ilike(services.name, '%Plumbing%'));
      console.log('Wildcard "%Plumbing%" results:', wildcardResult.length);
      
      // Test 3: Try case-sensitive
      console.log('--- Test 3: Case sensitive ---');
      const caseResult = await db.select()
        .from(services)
        .where(eq(services.name, 'Plumbing'));
      console.log('Case sensitive results:', caseResult.length);
      
      // Test 4: Manual filter 
      console.log('--- Test 4: Manual filter ---');
      const allServices = await db.select().from(services);
      const manualFilter = allServices.filter(service => 
        service.name?.toLowerCase().includes(searchTerm) ||
        service.category?.toLowerCase().includes(searchTerm) ||
        service.description?.toLowerCase().includes(searchTerm)
      );
      console.log('Manual filter results:', manualFilter.length);
      console.log('Manual filter data:', manualFilter.map(s => s.name));
      
      // Return manual filter for now
      return c.json(manualFilter);
      
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