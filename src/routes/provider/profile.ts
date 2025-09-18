import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { providers, providerServices, colleges, services, pastWorks } from '../../drizzle/schema.js';
import { eq, and, or, like, inArray } from 'drizzle-orm';
import { authMiddleware, serviceProviderRoleAuth } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';
import type { Service } from '../../types/types.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../../utils/cloudinary.js';
import type { InferInsertModel } from 'drizzle-orm'
const app = new Hono<CustomContext>();

// Apply auth to all routes
app.use('*', authMiddleware);

// Get provider profile
app.get('/', serviceProviderRoleAuth, async (c: Context<CustomContext>) => {
    try {
        const jwtUser = c.get('user');
        
        if (!jwtUser.providerId) {
            return c.json({ error: 'Provider ID not found in token' }, 401);
        }
        
        const provider = await db.query.providers.findFirst({
            where: eq(providers.id, jwtUser.providerId),
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
            return c.json({ error: 'Profile not found' }, 404);
        }

        // Extract services with their prices
        const servicesWithPrices = provider.services.map(ps => ({
            ...ps.service,
            price: ps.price // Include the price from providerServices
        }));

        return c.json({
            id: provider.id,
            userId: provider.userId,
            firstName: provider.firstName,
            lastName: provider.lastName,
            phoneNumber: provider.phoneNumber,
            collegeId: provider.collegeId,
            latitude: provider.latitude !== null ? Number(provider.latitude) : null,
            longitude: provider.longitude !== null ? Number(provider.longitude) : null,
            address: provider.address,
            bio: provider.bio,
            profileImageUrl: provider.profileImageUrl,
            isProfileComplete: provider.isProfileComplete,
            rating: provider.rating,
            completedRequests: provider.completedRequests,
            createdAt: provider.createdAt,
            updatedAt: provider.updatedAt,
            college: provider.college,
            services: servicesWithPrices, // Use services with prices
            pastWorks: provider.pastWorks,
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.post('/upload', serviceProviderRoleAuth, async (c) => {
    try {
        const jwtUser = c.get('user') as { id: string };
        const userId = parseInt(jwtUser.id, 10);

        const formData = await c.req.formData();
        const file = formData.get('image') as File;

        if (!file) {
            return c.json({ error: 'No file uploaded' }, 400);
        }

        if (file.size > 2 * 1024 * 1024) {
            return c.json({ error: 'File size exceeds 2MB limit' }, 400);
        }

        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            return c.json({ error: 'Only JPEG, PNG, and WebP images are allowed' }, 400);
        }

        const folderPath = `providers/${userId}/profile`;
        const { url } = await uploadToCloudinary(file, folderPath, c);

        return c.json({ url });
    } catch (error) {
        console.error('Error uploading file:', error);
        return c.json({ error: 'Failed to upload file' }, 500);
    }
});

// Helper function to extract public_id from Cloudinary URL
const extractPublicIdFromUrl = (url: string): string => {
    const parts = url.split('/');
    const uploadIndex = parts.findIndex(part => part === 'upload');
    if (uploadIndex === -1) return '';
    
    // Get everything after 'upload/v{version}/' or 'upload/'
    const pathAfterUpload = parts.slice(uploadIndex + 1).join('/');
    // Remove version if present (starts with 'v' followed by numbers)
    const withoutVersion = pathAfterUpload.replace(/^v\d+\//, '');
    // Remove file extension
    return withoutVersion.replace(/\.[^/.]+$/, '');
};

// Create/Update provider profile
app.put('/', serviceProviderRoleAuth, async (c) => {
    try {
        const jwtUser = c.get('user') as { id: string };
        const userId = parseInt(jwtUser.id, 10);

        const data = await c.req.json();
        console.log('🔍 Parsed request data:', data);
        
        // Handle past works data - only process if provided in request
        const pastWorksData = Array.isArray(data.pastWorks) 
            ? data.pastWorks.map((work: any) => ({
                id: work.id || null,
                imageUrl: work.imageUrl || '',
                description: work.description || '',
                shouldDelete: work.shouldDelete || false
            }))
            : null;

        // Normalize services to always be an array of IDs
        const serviceIds = Array.isArray(data.services)
            ? data.services.map((service: number | Service) => 
                typeof service === 'number' ? service : service.id
            )
            : [];
        
        // Ensure coordinates are properly formatted
        const latitude = data.latitude !== null && data.latitude !== undefined 
            ? Number(data.latitude) 
            : null;
        const longitude = data.longitude !== null && data.longitude !== undefined 
            ? Number(data.longitude) 
            : null;

        const existingProfile = await db.query.providers.findFirst({
            where: eq(providers.userId, userId),
            with: {
                pastWorks: true,
            },
        });

        let provider;
        if (existingProfile) {
            // Delete old profile image from Cloudinary if a new one is provided
            if (data.profileImageUrl && existingProfile.profileImageUrl && 
                data.profileImageUrl !== existingProfile.profileImageUrl) {
                try {
                    const publicId = extractPublicIdFromUrl(existingProfile.profileImageUrl);
                    if (publicId) {
                        await deleteFromCloudinary(publicId,c);
                    }
                } catch (error) {
                    console.error('Failed to delete old profile image:', error);
                }
            }

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
                    firstName: data.firstName,
                    lastName: data.lastName,
                    phoneNumber: data.phoneNumber,
                    collegeId: data.collegeId,
                    latitude: latitude,
                    longitude: longitude,
                    address: data.address,
                    bio: data.bio,
                    profileImageUrl: data.profileImageUrl,
                    userId,
                    isProfileComplete: true,
                } as typeof providers.$inferInsert)
                .returning();
        }

        // Update services with prices
        await db
            .delete(providerServices)
            .where(eq(providerServices.providerId, provider.id));

        if (serviceIds.length > 0) {
            // Extract services with their prices from the request data
            const servicesWithPrices = Array.isArray(data.services)
                ? data.services.map((service: any) => ({
                    id: typeof service === 'number' ? service : service.id,
                    price: typeof service === 'object' && service.price !== undefined 
                        ? service.price 
                        : null
                }))
                : [];

            await db.insert(providerServices).values(
                servicesWithPrices.map((service: any) => ({
                    providerId: provider.id,
                    serviceId: service.id,
                    price: service.price // Include the price
                }))
            );
        }

        // Handle past works updates - only if pastWorksData is provided (not null)
        if (pastWorksData !== null) {
            const existingWorks = existingProfile?.pastWorks || [];
            
            // Identify works to delete
            const worksToDelete = existingWorks.filter(existingWork => {
                const markedForDeletion = pastWorksData.some(
                    (work: { id: number | null; shouldDelete?: boolean }) => 
                        work.id === existingWork.id && work.shouldDelete
                );
                
                const notInNewData = !pastWorksData.some(
                    (work: { id: number | null }) => work.id === existingWork.id
                );
                
                return markedForDeletion || notInNewData;
            });

            // Delete identified works from Cloudinary and database
            for (const work of worksToDelete) {
                try {
                    const publicId = extractPublicIdFromUrl(work.imageUrl);
                    if (publicId) {
                        await deleteFromCloudinary(publicId, c);
                    }
                    await db.delete(pastWorks).where(eq(pastWorks.id, work.id));
                } catch (error) {
                    console.error('Failed to delete past work:', error);
                }
            }

            // Process new/updated works
            for (const work of pastWorksData) {
                if (work.shouldDelete) {
                    continue;
                }
                
                if (work.id) {
                    // Update existing work
                    await db
                        .update(pastWorks)
                        .set({
                            imageUrl: work.imageUrl,
                            description: work.description
                        })
                        .where(eq(pastWorks.id, work.id));
                } else {
                    // Insert new work
                    await db.insert(pastWorks).values({
                        providerId: provider.id,
                        imageUrl: work.imageUrl,
                        description: work.description,
                    });
                }
            }
        }

        // Fetch the updated profile with all relations
        const updatedProfile = await db.query.providers.findFirst({
            where: eq(providers.id, provider.id),
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

        if (!updatedProfile) {
            return c.json({ error: 'Failed to retrieve updated profile' }, 500);
        }

        // Extract services with their prices
        const servicesWithPrices = updatedProfile.services.map(ps => ({
            ...ps.service,
            price: ps.price // Include the price from providerServices
        }));

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
            profileImageUrl: updatedProfile.profileImageUrl,
            isProfileComplete: updatedProfile.isProfileComplete,
            rating: updatedProfile.rating,
            completedRequests: updatedProfile.completedRequests,
            createdAt: updatedProfile.createdAt,
            updatedAt: updatedProfile.updatedAt,
            college: updatedProfile.college,
            services: servicesWithPrices, // Use the services with prices
            pastWorks: updatedProfile.pastWorks,
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

        // Build the base query conditions
        const whereConditions = [eq(providers.isProfileComplete, true)];
        
        if (collegeId) {
            whereConditions.push(eq(providers.collegeId, parseInt(collegeId)));
        }
        
        if (search) {
            const searchCondition = or(
                like(providers.firstName, `%${search}%`),
                like(providers.lastName, `%${search}%`),
                like(providers.bio, `%${search}%`)
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
                // No providers found for this service - return early
                return c.json({
                    success: true,
                    data: []
                });
            }
            
            // Add provider ID filter to main query
            whereConditions.push(inArray(providers.id, providerIds));
        }

        // Execute the main query with all filters applied at database level
        const results = await db.query.providers.findMany({
            where: and(...whereConditions),
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

        // Clean transformation without redundant operations
        const transformedResults = results.map(provider => ({
            ...provider,
            latitude: provider.latitude !== null ? Number(provider.latitude) : null,
            longitude: provider.longitude !== null ? Number(provider.longitude) : null,
            services: provider.services.map(ps => ps.service),
            // pastWorks is already included from the spread operator
        }));

        return c.json({
            success: true,
            data: transformedResults
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
                pastWorks: true, // Add pastWorks relation
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
                latitude: provider.latitude !== null ? Number(provider.latitude) : null,
                longitude: provider.longitude !== null ? Number(provider.longitude) : null,
                address: provider.address,
                bio: provider.bio,
                rating: provider.rating,
                completedRequests: provider.completedRequests,
                profileImageUrl: provider.profileImageUrl,
                college: provider.college,
                services: provider.services.map(ps => ps.service),
                pastWorks: provider.pastWorks, // Include pastWorks
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

// Upload multiple images for past works
app.post('/upload-multiple', serviceProviderRoleAuth, async (c) => {
    try {
        const jwtUser = c.get('user') as { id: string };
        const userId = parseInt(jwtUser.id, 10);

        const formData = await c.req.formData();
        const files = formData.getAll('images') as File[];

        if (!files || files.length === 0) {
            return c.json({ error: 'No files uploaded' }, 400);
        }

        const uploadedUrls = [];
        
        for (const file of files) {
            if (file.size > 2 * 1024 * 1024) {
                return c.json({ error: `File ${file.name} exceeds 2MB limit` }, 400);
            }

            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
            if (!allowedTypes.includes(file.type)) {
                return c.json({ error: `File ${file.name} is not a supported image type` }, 400);
            }

            const folderPath = `providers/${userId}/past-works`;
            const { url } = await uploadToCloudinary(file, folderPath, c);
            uploadedUrls.push(url);
        }

        return c.json({ urls: uploadedUrls });
    } catch (error) {
        console.error('Error uploading files:', error);
        return c.json({ error: 'Failed to upload files' }, 500);
    }
});

export default app;