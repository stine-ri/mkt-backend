// src/routes/publicProviderRoutes.ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { providers, providerServices, services, colleges } from '../../drizzle/schema.js';
import { eq, and } from 'drizzle-orm';
import type { CustomContext } from '../../types/context.js';

const publicProviderRoutes = new Hono<CustomContext>();

// GET /api/provider/public/all

publicProviderRoutes.get('/all', async (c: Context<CustomContext>) => {
  try {
    const results = await db.select({
      provider: providers,
      providerService: providerServices, // Include providerServices
      service: services,
      college: colleges
    })
      .from(providers)
      .leftJoin(providerServices, eq(providers.id, providerServices.providerId))
      .leftJoin(services, eq(providerServices.serviceId, services.id))
      .leftJoin(colleges, eq(providers.collegeId, colleges.id))
      .where(eq(providers.isProfileComplete, true));

    const providersMap = new Map<number, any>();

    results.forEach(row => {
      const provider = row.provider;
      const providerService = row.providerService;
      const service = row.service;
      const college = row.college;

      if (!providersMap.has(provider.id)) {
        providersMap.set(provider.id, {
          ...provider,
          college: college || null,
          services: service ? [{
            ...service,
            price: providerService?.price || null // Include the price from providerServices
          }] : [],
          rating: provider.rating || null,
          completedRequests: provider.completedRequests || 0
        });
      } else {
        const existing = providersMap.get(provider.id);
        if (service && !existing.services.some((s: any) => s.id === service.id)) {
          existing.services.push({
            ...service,
            price: providerService?.price || null // Include the price from providerServices
          });
        }
      }
    });

    return c.json({
      success: true,
      data: Array.from(providersMap.values())
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
// GET /api/provider/public/:id
publicProviderRoutes.get('/:id', async (c: Context<CustomContext>) => {
  try {
    const providerId = parseInt(c.req.param('id'));

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
        pastWorks: true,
      },
    });

    if (!provider) {
      return c.json({
        success: false,
        error: 'Provider not found or profile incomplete'
      }, 404);
    }

    // Extract services with their prices from providerServices
    const extractedServices = provider.services.map(ps => ({
      ...ps.service,
      price: ps.price // Include the price from providerServices
    }));

    return c.json({
      success: true,
      data: {
        id: provider.id,
        firstName: provider.firstName,
        lastName: provider.lastName,
        college: provider.college,
        services: extractedServices, // Services with prices
        rating: provider.rating,
        completedRequests: provider.completedRequests,
        profileImageUrl: provider.profileImageUrl,
        bio: provider.bio,
        pastWorks: provider.pastWorks || [],
        phoneNumber: provider.phoneNumber,
        address: provider.address,
        latitude: provider.latitude,
        longitude: provider.longitude
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

export default publicProviderRoutes;
