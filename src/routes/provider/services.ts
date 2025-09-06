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
    const category = c.req.query('category'); //  category parameter
    
    console.log('=== SERVICE SEARCH ===');
    console.log('Search parameter:', search);
    console.log('Category parameter:', category);
    
    // Always get all services first
    const allServices = await db.select().from(services);
    
    let filteredResults = allServices;
    
    // Apply search filter
    if (search && search.trim() !== '') {
      const searchTerm = search.trim().toLowerCase();
      filteredResults = filteredResults.filter(service => {
        const nameMatch = service.name?.toLowerCase().includes(searchTerm) || false;
        const categoryMatch = service.category?.toLowerCase().includes(searchTerm) || false;
        const descriptionMatch = service.description?.toLowerCase().includes(searchTerm) || false;
        
        return nameMatch || categoryMatch || descriptionMatch;
      });
    }
    
    // Apply category filter
    if (category && category.trim() !== '' && category !== 'all') {
      const categoryTerm = category.trim().toLowerCase();
      filteredResults = filteredResults.filter(service => {
        return service.category?.toLowerCase().includes(categoryTerm);
      });
    }
    
    console.log('Filtered results:', filteredResults.length);
    return c.json(filteredResults);
    
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

//categories 
serviceRoutes.get('/categories', async (c) => {
  try {
    // Get unique categories from services
    const allServices = await db.select().from(services);
    
    // Extract unique categories
    const categoryMap = new Map();
    allServices.forEach(service => {
      if (service.category) {
        const cat = service.category.trim();
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
      }
    });
    
    // Convert to array format
    const categories = Array.from(categoryMap.entries()).map(([name, count], index) => ({
      id: index + 1,
      name,
      count
    }));
    
    return c.json(categories);
  } catch (error) {
    console.error('Error fetching service categories:', error);
    return c.json({ error: 'Failed to fetch categories' }, 500);
  }
});

export default serviceRoutes;