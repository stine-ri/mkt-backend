import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';
import { and, eq, or, ilike, like, sql } from 'drizzle-orm';

const serviceRoutes = new Hono();

serviceRoutes.get('/api/services', async (c) => {
  try {
    const search = c.req.query('q');
    
    console.log('Search parameter:', search);
    
    // Check if we have a valid search term
    if (search && search.trim() !== '') {
      const searchTerm = search.trim().toLowerCase();
      console.log('Searching for:', searchTerm);
      
      // Method 1: Try with raw SQL for better control
      try {
        const result = await db.select().from(services).where(
          or(
            sql`LOWER(${services.name}) LIKE ${'%' + searchTerm + '%'}`,
            sql`LOWER(${services.category}) LIKE ${'%' + searchTerm + '%'}`,
            sql`LOWER(${services.description}) LIKE ${'%' + searchTerm + '%'}`
          )
        );
        
        console.log(`SQL search returned ${result.length} results`);
        return c.json(result);
        
      } catch (sqlError) {
        console.log('SQL method failed, trying ilike method');
        
        // Method 2: Fallback to ilike
        const result = await db.select().from(services).where(
          or(
            ilike(services.name, `%${searchTerm}%`),
            ilike(services.category, `%${searchTerm}%`),
            ilike(services.description, `%${searchTerm}%`)
          )
        );
        
        console.log(`iLike search returned ${result.length} results`);
        return c.json(result);
      }
      
    } else {
      // No search term - return all services
      console.log('No search term provided, returning all services');
      const result = await db.select().from(services);
      return c.json(result);
    }
    
  } catch (err) {
    console.error('Service search error:', err);
    if (err instanceof Error) {
      return c.json({ 
        error: 'Failed to fetch services',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      }, 500);
    } else {
      return c.json({ error: 'Failed to fetch services' }, 500);
    }
  }
});

// Add a test endpoint to verify the issue
serviceRoutes.get('/api/services/test', async (c) => {
  try {
    // Test with hardcoded search
    const testTerm = 'cleaning';
    console.log('Testing search with term:', testTerm);
    
    const allServices = await db.select().from(services);
    console.log('Total services in DB:', allServices.length);
    
    const filtered = await db.select().from(services).where(
      or(
        ilike(services.name, `%${testTerm}%`),
        ilike(services.category, `%${testTerm}%`),
        ilike(services.description, `%${testTerm}%`)
      )
    );
    
    console.log('Filtered services:', filtered.length);
    
    return c.json({
      totalServices: allServices.length,
      searchTerm: testTerm,
      filteredCount: filtered.length,
      filteredResults: filtered,
      allServiceNames: allServices.map(s => s.name).slice(0, 10)
    });
    
  } catch (err) {
    console.error('Test endpoint error:', err);
    return c.json({ error: 'Test failed' }, 500);
  }
});

export default serviceRoutes;