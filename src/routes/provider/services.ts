import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services, providers,providerServices, users } from '../../drizzle/schema.js';
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

// serviceRoutes.js
serviceRoutes.get('/services', async (c) => {
  try {
    const search = c.req.query('q');
    const category = c.req.query('category');
    
    console.log('=== SERVICE SEARCH WITH PROVIDERS ===');
    console.log('Search:', search);
    console.log('Category:', category);
    
    // Get services with provider information
    const servicesWithProviders = await db
      .select({
        service: services,
        provider: providers,
        user: users
      })
      .from(services)
      .leftJoin(providerServices, eq(services.id, providerServices.serviceId))
      .leftJoin(providers, eq(providerServices.providerId, providers.id))
      .leftJoin(users, eq(providers.userId, users.id))
      .where(category && category !== 'all' 
        ? ilike(services.category, `%${category}%`)
        : undefined
      );
    
    // Group services by service ID (since one service can have multiple providers)
    const serviceMap = new Map();
    
    servicesWithProviders.forEach(item => {
      const serviceId = item.service.id;
      
      if (!serviceMap.has(serviceId)) {
        serviceMap.set(serviceId, {
          ...item.service,
          providers: []
        });
      }
      
      if (item.provider && item.user) {
        const existingService = serviceMap.get(serviceId);
        existingService.providers.push({
          ...item.provider,
          user: item.user
        });
      }
    });
    
    const result = Array.from(serviceMap.values());
    
    // Apply search filter if provided
    let filteredResults = result;
    if (search && search.trim() !== '') {
      const searchTerm = search.trim().toLowerCase();
      filteredResults = result.filter(service => {
        const nameMatch = service.name?.toLowerCase().includes(searchTerm) || false;
        const categoryMatch = service.category?.toLowerCase().includes(searchTerm) || false;
        const descriptionMatch = service.description?.toLowerCase().includes(searchTerm) || false;
        
        return nameMatch || categoryMatch || descriptionMatch;
      });
    }
    
    console.log('Services with providers:', filteredResults.length);
    return c.json(filteredResults);
    
  } catch (err) {
    console.error('Services search error:', err);
    return c.json({ error: 'Failed to fetch services' }, 500);
  }
});

// Get single service with providers
serviceRoutes.get('/services/:id', async (c) => {
  try {
    const serviceId = parseInt(c.req.param('id'));
    
    if (isNaN(serviceId)) {
      return c.json({ error: 'Invalid service ID' }, 400);
    }

    // Get service with all providers
    const serviceWithProviders = await db
      .select({
        service: services,
        provider: providers,
        user: users,
        providerService: providerServices
      })
      .from(services)
      .leftJoin(providerServices, eq(services.id, providerServices.serviceId))
      .leftJoin(providers, eq(providerServices.providerId, providers.id))
      .leftJoin(users, eq(providers.userId, users.id))
      .where(eq(services.id, serviceId));

    if (!serviceWithProviders.length) {
      return c.json({ error: 'Service not found' }, 404);
    }

    // Structure the response
    const serviceData = {
      ...serviceWithProviders[0].service,
      providers: serviceWithProviders
        .filter(item => item.provider) // Only include entries with providers
        .map(item => ({
          ...item.provider,
          user: item.user,
          price: item.providerService?.price
        }))
    };

    return c.json(serviceData);
  } catch (err) {
    console.error('Service details error:', err);
    return c.json({ error: 'Failed to fetch service details' }, 500);
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
serviceRoutes.get('/services/categories', async (c) => {
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