import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { providers, providerServices,colleges, services  } from '../../drizzle/schema.js';
import { eq, and,  or, like } from 'drizzle-orm';
import { authMiddleware, serviceProviderRoleAuth } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';
import type { Service } from '../../types/types.js'; 
import { uploadFile } from '../../utils/filestorage.js'; 
import { serveStatic } from '@hono/node-server/serve-static';
import { env } from 'hono/adapter';

const app = new Hono<CustomContext>();

app.use('/uploads/*', serveStatic({ root: './' }));

// Apply auth to all routes
app.use('*', authMiddleware, serviceProviderRoleAuth);

// Get provider profile
app.get('/', async (c: Context<CustomContext>) => {
    const jwtUser = c.get('user') as { id: string };
    const userId = parseInt(jwtUser.id, 10);
    
    const provider = await db.query.providers.findFirst({
        where: eq(providers.userId, userId),
        with: {
            college: true,
            services: {
                with: {
                    service: true,
                },
            },
        },
    });

    if (!provider) {
        return c.json({ error: 'Profile not found' }, 404);
    }

    // Return the same structure as PUT for consistency
    return c.json({
      id: provider.id,
      userId: provider.userId,
      firstName: provider.firstName,
      lastName: provider.lastName,
      phoneNumber: provider.phoneNumber,
      collegeId: provider.collegeId,
      latitude: provider.latitude,
      longitude: provider.longitude,
      address: provider.address,
      bio: provider.bio,
      isProfileComplete: provider.isProfileComplete,
      rating: provider.rating,
      completedRequests: provider.completedRequests,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
      college: provider.college,
      services: provider.services.map(ps => ps.service),
    });
});

app.post('/upload', async (c) => {
  try {
    const jwtUser = c.get('user') as { id: string };
    const userId = parseInt(jwtUser.id, 10);

    const formData = await c.req.formData();
    const file = formData.get('image') as File;

    if (!file) {
      return c.json({ error: 'No file uploaded' }, 400);
    }

    // Check file size (e.g., 2MB max)
    if (file.size > 2 * 1024 * 1024) {
      return c.json({ error: 'File size exceeds 2MB limit' }, 400);
    }

    // Check file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: 'Only JPEG, PNG, and WebP images are allowed' }, 400);
    }

    // Upload the file (implement this function based on your storage solution)
    const fileUrl = await uploadFile(file, `providers/${userId}`, c);

    return c.json({ url: fileUrl });
  } catch (error) {
    console.error('Error uploading file:', error);
    return c.json({ error: 'Failed to upload file' }, 500);
  }
});

// Create/Update provider profile
app.put('/', async (c) => {
  try {
    const jwtUser = c.get('user') as { id: string };
    const userId = parseInt(jwtUser.id, 10);

    const data = await c.req.json();
    console.log('🔍 Parsed request data:', data);

    // Normalize services to always be an array of IDs
    const serviceIds = Array.isArray(data.services)
      ? data.services.map((service: number | Service) => 
          typeof service === 'number' ? service : service.id
        )
      : [];

    const existingProfile = await db.query.providers.findFirst({
      where: eq(providers.userId, userId),
    });

    let provider;
    if (existingProfile) {
      [provider] = await db
        .update(providers)
        .set({
          firstName: data.firstName,
          lastName: data.lastName,
          phoneNumber: data.phoneNumber,
          collegeId: data.collegeId,
          latitude: data.latitude,
          longitude: data.longitude,
          address: data.address,
          bio: data.bio,
          profileImageUrl: data.profileImageUrl,
          isProfileComplete: true,
          updatedAt: new Date(),
        })
        .where(eq(providers.userId, userId))
        .returning();
    } else {
      [provider] = await db
        .insert(providers)
        .values({
          ...data,
          userId,
          isProfileComplete: true,
        })
        .returning();
    }

    // Update services using the normalized IDs
    await db
      .delete(providerServices)
      .where(eq(providerServices.providerId, provider.id));

    if (serviceIds.length > 0) {
      await db.insert(providerServices).values(
        serviceIds.map((serviceId: number) => ({
          providerId: provider.id,
          serviceId,
        }))
      );
    }

    const updatedProfile = await db.query.providers.findFirst({
      where: eq(providers.id, provider.id),
      with: {
        college: true,
        services: {
          with: {
            service: true,
          },
        },
      },
    });

    if (!updatedProfile) {
      return c.json({ error: 'Failed to retrieve updated profile' }, 500);
    }

    return c.json({
      id: updatedProfile.id,
      userId: updatedProfile.userId,
      firstName: updatedProfile.firstName,
      lastName: updatedProfile.lastName,
      phoneNumber: updatedProfile.phoneNumber,
      collegeId: updatedProfile.collegeId,
      latitude: updatedProfile.latitude,
      longitude: updatedProfile.longitude,
      address: updatedProfile.address,
      bio: updatedProfile.bio,
      isProfileComplete: updatedProfile.isProfileComplete,
      rating: updatedProfile.rating,
      completedRequests: updatedProfile.completedRequests,
      createdAt: updatedProfile.createdAt,
      updatedAt: updatedProfile.updatedAt,
      college: updatedProfile.college,
      services: updatedProfile.services.map(ps => ps.service),
    });
    
  } catch (error) {
    console.error('❌ Error in provider PUT /:', error);
    return c.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});



// Get all service providers (public route - no auth required)
app.get('/all', async (c: Context<CustomContext>) => {
    try {
        const { serviceId, collegeId, search } = c.req.query();

        // Build conditions array
        const conditions = [eq(providers.isProfileComplete, true)];

        if (serviceId) {
            conditions.push(eq(services.id, parseInt(serviceId)));
        }
        if (collegeId) {
            conditions.push(eq(colleges.id, parseInt(collegeId)));
        }
        if (search) {
            const searchCondition = or(
                like(providers.firstName, `%${search}%`),
                like(providers.lastName, `%${search}%`),
                like(providers.bio, `%${search}%`)
            );
            if (searchCondition) {
                conditions.push(searchCondition);
            }
        }

        // Single query with all conditions - filter out undefined values
        const results = await db.select()
            .from(providers)
            .leftJoin(providerServices, eq(providers.id, providerServices.providerId))
            .leftJoin(services, eq(providerServices.serviceId, services.id))
            .leftJoin(colleges, eq(providers.collegeId, colleges.id))
            .where(and(...conditions.filter(Boolean)));

        // Transform results...
        const providersMap = new Map<number, any>();
        
        results.forEach(row => {
            const provider = row.providers;
            const service = row.services;
            const college = row.colleges;

            if (!providersMap.has(provider.id)) {
                providersMap.set(provider.id, {
                    ...provider,
                    college,
                    services: service ? [service] : []
                });
            } else {
                const existing = providersMap.get(provider.id);
                if (service && !existing.services.some((s: any) => s.id === service.id)) {
                    existing.services.push(service);
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


// Get a specific provider's public profile
app.get('/:id', async (c: Context<CustomContext>) => {
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
            },
        });

        if (!provider) {
            return c.json({ 
                success: false,
                error: 'Provider not found or profile incomplete'
            }, 404);
        }

        return c.json({
            success: true,
            data: {
                id: provider.id,
                firstName: provider.firstName,
                lastName: provider.lastName,
                phoneNumber: provider.phoneNumber,
                collegeId: provider.collegeId,
                latitude: provider.latitude,
                longitude: provider.longitude,
                address: provider.address,
                bio: provider.bio,
                rating: provider.rating,
                completedRequests: provider.completedRequests,
                profileImageUrl: provider.profileImageUrl,
                college: provider.college,
                services: provider.services.map(ps => ps.service),
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

// Then create public versions of the routes that skip authentication
app.get('/public/all', (c, next) => next(), async (c: Context<CustomContext>) => {
    // Copy the exact implementation from your /all route
    try {
        const { serviceId, collegeId, search } = c.req.query();

        // Build conditions array
        const conditions = [eq(providers.isProfileComplete, true)];

        if (serviceId) {
            conditions.push(eq(services.id, parseInt(serviceId)));
        }
        if (collegeId) {
            conditions.push(eq(colleges.id, parseInt(collegeId)));
        }
        if (search) {
            const searchCondition = or(
                like(providers.firstName, `%${search}%`),
                like(providers.lastName, `%${search}%`),
                like(providers.bio, `%${search}%`)
            );
            if (searchCondition) {
                conditions.push(searchCondition);
            }
        }

        const results = await db.select()
            .from(providers)
            .leftJoin(providerServices, eq(providers.id, providerServices.providerId))
            .leftJoin(services, eq(providerServices.serviceId, services.id))
            .leftJoin(colleges, eq(providers.collegeId, colleges.id))
            .where(and(...conditions.filter(Boolean)));

        const providersMap = new Map<number, any>();
        
        results.forEach(row => {
            const provider = row.providers;
            const service = row.services;
            const college = row.colleges;

            if (!providersMap.has(provider.id)) {
                providersMap.set(provider.id, {
                    ...provider,
                    college,
                    services: service ? [service] : []
                });
            } else {
                const existing = providersMap.get(provider.id);
                if (service && !existing.services.some((s: any) => s.id === service.id)) {
                    existing.services.push(service);
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

app.get('/public/:id', (c, next) => next(), async (c: Context<CustomContext>) => {
    // Copy the exact implementation from your /:id route
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
            },
        });

        if (!provider) {
            return c.json({ 
                success: false,
                error: 'Provider not found or profile incomplete'
            }, 404);
        }

        // Return only public-safe fields
        return c.json({
            success: true,
            data: {
                id: provider.id,
                firstName: provider.firstName,
                lastName: provider.lastName,
                college: provider.college,
                services: provider.services.map(ps => ps.service),
                rating: provider.rating,
                completedRequests: provider.completedRequests,
                profileImageUrl: provider.profileImageUrl,
                bio: provider.bio
                // Exclude sensitive fields like:
                // phoneNumber, address, exact coordinates, etc.
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


export default app;