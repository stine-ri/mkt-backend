import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services } from '../../drizzle/schema.js';
import { and, eq, or, ilike, like, sql } from 'drizzle-orm';

const serviceRoutes = new Hono();

serviceRoutes.get('/api/services', async (c) => {
  try {
    const search = c.req.query('q');
    
    console.log('=== MAIN SEARCH ENDPOINT ===');
    console.log('Search parameter:', search);
    
    if (search && search.trim() !== '') {
      const searchTerm = search.trim().toLowerCase();
      console.log('Searching for term:', searchTerm);
      
      // Use the EXACT SAME query as the test endpoint that works
      const result = await db
        .select()
        .from(services)
        .where(
          or(
            ilike(services.name, `%${searchTerm}%`),
            ilike(services.category, `%${searchTerm}%`),
            ilike(services.description, `%${searchTerm}%`)
          )
        );
      
      console.log('Query executed - results:', result.length);
      console.log('Results details:', result.map(r => ({
        id: r.id,
        name: r.name,
        category: r.category
      })));
      
      // Double-check with manual filter
      const allServices = await db.select().from(services);
      const manualFilter = allServices.filter(service => {
        const name = (service.name || '').toLowerCase();
        const category = (service.category || '').toLowerCase();
        const description = (service.description || '').toLowerCase();
        
        return name.includes(searchTerm) || 
               category.includes(searchTerm) || 
               description.includes(searchTerm);
      });
      
      console.log('Manual filter results:', manualFilter.length);
      console.log('Manual filter details:', manualFilter.map(r => ({
        id: r.id,
        name: r.name,
        category: r.category
      })));
      
      // If results don't match, there's a query issue
      if (result.length !== manualFilter.length) {
        console.error('QUERY MISMATCH!');
        console.error('SQL results:', result.length);
        console.error('Manual filter:', manualFilter.length);
        // Return manual filter results as fallback
        return c.json(manualFilter);
      }
      
      return c.json(result);
      
    } else {
      console.log('No search term - returning all services');
      const result = await db.select().from(services);
      return c.json(result);
    }
    
  } catch (err) {
    console.error('Main search error:', err);
    
    // Fallback to manual filter if SQL fails
    try {
      const search = c.req.query('q');
      if (search && search.trim() !== '') {
        const searchTerm = search.trim().toLowerCase();
        console.log('Falling back to manual filter for:', searchTerm);
        
        const allServices = await db.select().from(services);
        const filtered = allServices.filter(service => {
          const name = (service.name || '').toLowerCase();
          const category = (service.category || '').toLowerCase();
          const description = (service.description || '').toLowerCase();
          
          return name.includes(searchTerm) || 
                 category.includes(searchTerm) || 
                 description.includes(searchTerm);
        });
        
        console.log('Fallback results:', filtered.length);
        return c.json(filtered);
      }
    } catch (fallbackErr) {
      console.error('Fallback also failed:', fallbackErr);
    }
    
    return c.json({ error: 'Failed to fetch services' }, 500);
  }
});

// Keep the working test endpoint
serviceRoutes.get('/api/services/test', async (c) => {
  try {
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