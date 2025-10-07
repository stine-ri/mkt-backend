import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services, providers, providerServices, users } from '../../drizzle/schema.js';
import { ilike, or, eq, count, sql } from 'drizzle-orm';

const serviceRoutes = new Hono();

// Get all service types (grouped services with provider counts)
serviceRoutes.get('/services', async (c) => {
  try {
    const search = c.req.query('q');
    const category = c.req.query('category');
    
    console.log('=== FETCHING SERVICE TYPES ===');
    console.log('Search:', search);
    console.log('Category:', category);
    
    // First, get all services
    const allServices = await db
      .select()
      .from(services)
      .orderBy(services.createdAt);

    // Then, for each service, count its providers
    const servicesWithCounts = await Promise.all(
      allServices.map(async (service) => {
        const providerCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(providerServices)
          .where(eq(providerServices.serviceId, service.id));
        
        return {
          id: service.id,
          name: service.name,
          description: service.description,
          category: service.category,
          createdAt: service.createdAt,
          providerCount: Number(providerCount[0]?.count || 0)
        };
      })
    );

    let result = servicesWithCounts;

    // Apply category filter if provided
    if (category && category.trim() !== '' && category !== 'all') {
      const categoryTerm = category.trim().toLowerCase();
      result = result.filter(s => s.category?.toLowerCase().includes(categoryTerm));
    }

    // Apply search filter if provided
    if (search && search.trim() !== '') {
      const searchTerm = search.trim().toLowerCase();
      result = result.filter(service => {
        const nameMatch = service.name?.toLowerCase().includes(searchTerm) || false;
        const categoryMatch = service.category?.toLowerCase().includes(searchTerm) || false;
        const descriptionMatch = service.description?.toLowerCase().includes(searchTerm) || false;
        
        return nameMatch || categoryMatch || descriptionMatch;
      });
    }

    console.log('✅ Service types found:', result.length);
    console.log('Sample service with count:', result[0]);
    
    return c.json(result);
    
  } catch (err) {
    console.error('❌ Services error:', err);
    return c.json({ error: 'Failed to fetch services' }, 500);
  }
});

// Get single service type with all providers
serviceRoutes.get('/services/:id', async (c) => {
  try {
    const serviceId = parseInt(c.req.param('id'));
    
    if (isNaN(serviceId)) {
      return c.json({ error: 'Invalid service ID' }, 400);
    }

    console.log('🔍 Fetching service type with providers for ID:', serviceId);

    // Get service details
    const serviceDetails = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    if (!serviceDetails.length) {
      return c.json({ error: 'Service not found' }, 404);
    }

    // Get all providers for this service
    const serviceProviders = await db
      .select({
        provider: providers,
        user: users,
        providerService: providerServices
      })
      .from(providerServices)
      .innerJoin(providers, eq(providerServices.providerId, providers.id))
      .leftJoin(users, eq(providers.userId, users.id))
      .where(eq(providerServices.serviceId, serviceId));

    const formattedProviders = serviceProviders.map(item => ({
      id: item.provider.id,
      firstName: item.provider.firstName,
      lastName: item.provider.lastName,
      bio: item.provider.bio,
      rating: item.provider.rating,
      completedRequests: item.provider.completedRequests,
      address: item.provider.address,
      profileImageUrl: item.provider.profileImageUrl,
      user: item.user || {},
      price: item.providerService?.price || null
    }));

    const serviceData = {
      ...serviceDetails[0],
      providers: formattedProviders,
      providerCount: formattedProviders.length
    };

    console.log('✅ Service details prepared with', formattedProviders.length, 'providers');

    return c.json(serviceData);
  } catch (err) {
    console.error('❌ Service details error:', err);
    return c.json({ error: 'Failed to fetch service details' }, 500);
  }
});

// Get service categories with counts
serviceRoutes.get('/services/categories', async (c) => {
  try {
    const allServices = await db.select().from(services);
    
    const categoryMap = new Map();
    allServices.forEach(service => {
      if (service.category) {
        const cat = service.category.trim();
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
      }
    });
    
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