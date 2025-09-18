// src/routes/publicProviderRoutes.ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { providers, providerServices, services, colleges, pastWorks } from '../../drizzle/schema.js';
import { eq, and } from 'drizzle-orm';
import type { CustomContext } from '../../types/context.js';

const publicProviderRoutes = new Hono<CustomContext>();

// GET /api/provider/public/all
publicProviderRoutes.get('/all', async (c: Context<CustomContext>) => {
  try {
    const providersList = await db.query.providers.findMany({
      where: eq(providers.isProfileComplete, true),
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

    // Transform the data to include prices
    const transformedProviders = providersList.map(provider => ({
      ...provider,
      services: provider.services.map(ps => ({
        ...ps.service,
        price: ps.price // Include the price from providerServices
      })),
      latitude: provider.latitude !== null ? Number(provider.latitude) : null,
      longitude: provider.longitude !== null ? Number(provider.longitude) : null,
    }));

    return c.json({
      success: true,
      data: transformedProviders
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

export default publicProviderRoutes;