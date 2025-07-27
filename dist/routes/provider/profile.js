import { Hono } from 'hono';
import { db } from '../../drizzle/db';
import { providers, providerServices } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { authMiddleware, serviceProviderRoleAuth } from '../../middleware/bearAuth';
const app = new Hono();
// Apply auth to all routes
app.use('*', authMiddleware, serviceProviderRoleAuth);
// Get provider profile
app.get('/', async (c) => {
    const jwtUser = c.get('user');
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
// Create/Update provider profile
app.put('/', async (c) => {
    try {
        const jwtUser = c.get('user');
        const userId = parseInt(jwtUser.id, 10);
        const data = await c.req.json();
        console.log('🔍 Parsed request data:', data);
        // Normalize services to always be an array of IDs
        const serviceIds = Array.isArray(data.services)
            ? data.services.map((service) => typeof service === 'number' ? service : service.id)
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
                isProfileComplete: true,
                updatedAt: new Date(),
            })
                .where(eq(providers.userId, userId))
                .returning();
        }
        else {
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
            await db.insert(providerServices).values(serviceIds.map((serviceId) => ({
                providerId: provider.id,
                serviceId,
            })));
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
    }
    catch (error) {
        console.error('❌ Error in provider PUT /:', error);
        return c.json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});
export default app;
