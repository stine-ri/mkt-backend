// src/routes/publicProviderRoutes.ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { providers, providerServices, services, colleges, pastWorks } from '../../drizzle/schema.js';
import { eq, and, inArray, or, like } from 'drizzle-orm';
import type { CustomContext } from '../../types/context.js';

const publicProviderRoutes = new Hono<CustomContext>();

// GET /api/provider/public/all - Enhanced with filtering support
publicProviderRoutes.get('/all', async (c: Context<CustomContext>) => {
  try {
    const { serviceId, collegeId, search } = c.req.query();

    // Build where conditions
    const whereConditions = [eq(providers.isProfileComplete, true)];
    
    // College filter
    if (collegeId) {
      whereConditions.push(eq(providers.collegeId, parseInt(collegeId)));
    }

    // Search filter (name, bio, or address)
    if (search) {
      const searchCondition = or(
        like(providers.firstName, `%${search}%`),
        like(providers.lastName, `%${search}%`),
        like(providers.bio, `%${search}%`),
        like(providers.address, `%${search}%`)
      );
      if (searchCondition) {
        whereConditions.push(searchCondition);
      }
    }

    // Handle service filtering at database level for better performance
    if (serviceId) {
      const targetServiceId = parseInt(serviceId);
      
      // Get provider IDs that offer the requested service
      const serviceProviderIds = await db
        .select({ providerId: providerServices.providerId })
        .from(providerServices)
        .where(eq(providerServices.serviceId, targetServiceId));
      
      const providerIds = serviceProviderIds.map(sp => sp.providerId);
      
      if (providerIds.length === 0) {
        // No providers found for this service - return empty array
        return c.json({
          success: true,
          data: [],
          count: 0
        });
      }
      
      // Add provider ID filter to main query
      whereConditions.push(inArray(providers.id, providerIds));
    }

    // Fetch providers with all relations
    const providersList = await db.query.providers.findMany({
      where: and(...whereConditions),
      with: {
        college: true,
        services: {
          with: {
            service: true,
          },
        },
        pastWorks: {
          orderBy: (pastWorks, { desc }) => [desc(pastWorks.createdAt)],
        },
      },
      orderBy: (providers, { desc }) => [desc(providers.rating), desc(providers.completedRequests)],
    });

    // Transform the data to include prices and format coordinates
    const transformedProviders = providersList.map(provider => ({
      ...provider,
      services: provider.services.map(ps => ({
        ...ps.service,
        price: ps.price // Include the price from providerServices
      })),
      latitude: provider.latitude !== null ? Number(provider.latitude) : null,
      longitude: provider.longitude !== null ? Number(provider.longitude) : null,
      pastWorks: provider.pastWorks || [],
    }));

    return c.json({
      success: true,
      data: transformedProviders,
      count: transformedProviders.length
    });

  } catch (error) {
    console.error('Error fetching providers:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch providers',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/provider/public/:id - Enhanced with ordered past works
publicProviderRoutes.get('/:id', async (c: Context<CustomContext>) => {
  try {
    const providerId = parseInt(c.req.param('id'));

    if (isNaN(providerId)) {
      return c.json({
        success: false,
        error: 'Invalid provider ID'
      }, 400);
    }

    const provider = await db.query.providers.findFirst({
      where: and(
        eq(providers.id, providerId),
        eq(providers.isProfileComplete, true)
      ),
      with: {
        college: true,
        services: {
          with: {
            service: true,
          },
        },
        pastWorks: {
          orderBy: (pastWorks, { desc }) => [desc(pastWorks.createdAt)],
        },
      },
    });

    if (!provider) {
      return c.json({
        success: false,
        error: 'Provider not found or profile incomplete'
      }, 404);
    }

    // Extract services with their prices from providerServices
    const servicesWithPrices = provider.services.map(ps => ({
      ...ps.service,
      price: ps.price // Include the price from providerServices
    }));

    return c.json({
      success: true,
      data: {
        id: provider.id,
        firstName: provider.firstName,
        lastName: provider.lastName,
        phoneNumber: provider.phoneNumber,
        collegeId: provider.collegeId,
        latitude: provider.latitude !== null ? Number(provider.latitude) : null,
        longitude: provider.longitude !== null ? Number(provider.longitude) : null,
        address: provider.address,
        bio: provider.bio,
        rating: provider.rating,
        completedRequests: provider.completedRequests,
        profileImageUrl: provider.profileImageUrl,
        college: provider.college,
        services: servicesWithPrices, // Services with prices
        pastWorks: provider.pastWorks || [],
      }
    });

  } catch (error) {
    console.error('Error fetching provider:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch provider',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/provider/public/services - Get all available services
publicProviderRoutes.get('/services', async (c: Context<CustomContext>) => {
  try {
    const allServices = await db.query.services.findMany({
      orderBy: (services, { asc }) => [asc(services.name)],
    });

    return c.json({
      success: true,
      data: allServices
    });

  } catch (error) {
    console.error('Error fetching services:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch services',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/provider/public/colleges - Get all colleges
publicProviderRoutes.get('/colleges', async (c: Context<CustomContext>) => {
  try {
    const allColleges = await db.query.colleges.findMany({
      orderBy: (colleges, { asc }) => [asc(colleges.name)],
    });

    return c.json({
      success: true,
      data: allColleges
    });

  } catch (error) {
    console.error('Error fetching colleges:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch colleges',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default publicProviderRoutes;