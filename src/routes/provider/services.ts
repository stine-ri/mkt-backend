import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { services, providers, providerServices, users } from '../../drizzle/schema.js';
import { ilike, or, eq, count, sql } from 'drizzle-orm';

const serviceRoutes = new Hono();

// IMPORTANT: Specific routes MUST come BEFORE parameterized routes!
// Otherwise '/services/categories' will match '/services/:id' with id='categories'

// Debug endpoint - Check database state
serviceRoutes.get('/services/debug', async (c) => {
  try {
    console.log('🔍 DEBUG ENDPOINT CALLED');
    
    // Get all services
    const allServices = await db.select().from(services);
    
    // Get all provider-service links
    const allProviderServices = await db.select().from(providerServices);
    
    // Get all providers
    const allProviders = await db.select().from(providers);
    
    console.log('📊 DEBUG INFO:');
    console.log('Total services:', allServices.length);
    console.log('Total providerServices entries:', allProviderServices.length);
    console.log('Total providers:', allProviders.length);
    
    // Count providers per service
    const providerCountByService: Record<number, number> = {};
    allProviderServices.forEach(ps => {
      if (!providerCountByService[ps.serviceId]) {
        providerCountByService[ps.serviceId] = 0;
      }
      providerCountByService[ps.serviceId]++;
    });
    
    console.log('Provider count by service ID:', providerCountByService);
    
    return c.json({
      summary: {
        totalServices: allServices.length,
        totalProviderServices: allProviderServices.length,
        totalProviders: allProviders.length
      },
      providerCountByService,
      services: allServices.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        providerCount: providerCountByService[s.id] || 0
      })),
      providerServices: allProviderServices.slice(0, 20),
      providers: allProviders.slice(0, 3)
    });
  } catch (error) {
    console.error('Debug error:', error);
    
    if (error instanceof Error) {
      return c.json({ error: 'Debug failed', details: error.message }, 500);
    }

    // Fallback for non-Error values
    return c.json({ error: 'Debug failed', details: String(error) }, 500);
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

// Get all service types (grouped services with provider counts)
// OPTIMIZED VERSION - Single query with JOIN and GROUP BY
serviceRoutes.get('/services', async (c) => {
  try {
    const search = c.req.query('q');
    const category = c.req.query('category');
    
    console.log('=== FETCHING SERVICE TYPES (OPTIMIZED) ===');
    console.log('Search:', search);
    console.log('Category:', category);
    
    // OPTIMIZED: Single query with LEFT JOIN and COUNT
    const servicesWithCounts = await db
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        category: services.category,
        createdAt: services.createdAt,
        // Count distinct provider IDs for each service
        providerCount: sql<number>`CAST(COUNT(DISTINCT ${providerServices.providerId}) AS INTEGER)`
      })
      .from(services)
      .leftJoin(providerServices, eq(services.id, providerServices.serviceId))
      .groupBy(services.id, services.name, services.description, services.category, services.createdAt)
      .orderBy(services.createdAt);

    console.log('📋 Total services found:', servicesWithCounts.length);
    
    // Log each service with its provider count
    servicesWithCounts.forEach(service => {
      console.log(`   • ${service.name} (ID: ${service.id}): ${service.providerCount} providers`);
    });

    let result = servicesWithCounts;

    // Apply category filter if provided
    if (category && category.trim() !== '' && category !== 'all') {
      const categoryTerm = category.trim().toLowerCase();
      result = result.filter(s => s.category?.toLowerCase().includes(categoryTerm));
      console.log(`📂 Filtered by category "${category}": ${result.length} services`);
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
      console.log(`🔎 Filtered by search "${search}": ${result.length} services`);
    }

    console.log('\n✅ FINAL RESULT - Service types with provider counts:', result.length);
    console.log('📊 Sample data:', JSON.stringify(result.slice(0, 3), null, 2));
    
    return c.json(result);
    
  } catch (err) {
    console.error('❌ Services error:', err);

    if (err instanceof Error) {
      console.error('Error details:', err.message);
      console.error('Stack:', err.stack);
      return c.json({ error: 'Failed to fetch services', details: err.message }, 500);
    }

    // Fallback if it's not an Error object (e.g. a string or object)
    return c.json({ error: 'Failed to fetch services', details: String(err) }, 500);
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
      // IMPORTANT: phoneNumber is the correct field name from the schema
      phone: item.provider.phoneNumber || item.user?.contact_phone || null,
      user: item.user ? {
        id: item.user.id,
        full_name: item.user.full_name,
        email: item.user.email,
        contact_phone: item.user.contact_phone,
        address: item.user.address,
        avatar: item.user.avatar,
        role: item.user.role
      } : null,
      price: item.providerService?.price || null
    }));

    const serviceData = {
      ...serviceDetails[0],
      providers: formattedProviders,
      providerCount: formattedProviders.length
    };

    console.log('✅ Service details prepared with', formattedProviders.length, 'providers');
    console.log('📱 Sample provider phone:', formattedProviders[0]?.phone);

    return c.json(serviceData);
  } catch (err) {
    console.error('❌ Service details error:', err);
    return c.json({ error: 'Failed to fetch service details' }, 500);
  }
});

export default serviceRoutes;