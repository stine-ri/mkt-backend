import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { productSellers, colleges, products } from '../../drizzle/schema.js';
import { eq, and , like, or , SQL} from 'drizzle-orm';
import { authMiddleware, productSellerRoleAuth } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../../utilis/cloudinary.js';

const app = new Hono<CustomContext>();

// Apply auth to all routes
app.use('*', authMiddleware);

// Get product seller profile

app.get('/', productSellerRoleAuth, async (c: Context<CustomContext>) => {
  try {
    const jwtUser = c.get('user');

    if (!jwtUser?.id) {
      return c.json({ error: 'User ID missing from token' }, 400);
    }

    // Convert string to number
    const userId = Number(jwtUser.id);
    if (isNaN(userId)) {
      return c.json({ error: 'Invalid User ID in token' }, 400);
    }

    const productSeller = await db.query.productSellers.findFirst({
      where: eq(productSellers.userId, userId), // ✅ now it's a number
      with: {
        college: true,
        products: true,
      },
    });

    if (!productSeller) {
      return c.json({
        id: null,
        userId,
        firstName: null,
        lastName: null,
        phoneNumber: null,
        collegeId: null,
        latitude: null,
        longitude: null,
        address: null,
        bio: null,
        profileImageUrl: null,
        isProfileComplete: false,
        rating: null,
        completedSales: null,
        createdAt: null,
        updatedAt: null,
        college: null,
        products: [],
      }, 200);
    }

    return c.json({
      id: productSeller.id,
      userId: productSeller.userId,
      firstName: productSeller.firstName,
      lastName: productSeller.lastName,
      phoneNumber: productSeller.phoneNumber,
      collegeId: productSeller.collegeId,
      latitude: productSeller.latitude !== null ? Number(productSeller.latitude) : null,
      longitude: productSeller.longitude !== null ? Number(productSeller.longitude) : null,
      address: productSeller.address,
      bio: productSeller.bio,
      profileImageUrl: productSeller.profileImageUrl,
      isProfileComplete: productSeller.isProfileComplete,
      rating: productSeller.rating,
      completedSales: productSeller.completedSales,
      createdAt: productSeller.createdAt,
      updatedAt: productSeller.updatedAt,
      college: productSeller.college,
      products: productSeller.products,
    });
  } catch (error) {
    console.error('Error fetching product seller profile:', error);
    return c.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});




// Upload profile image
app.post('/upload', productSellerRoleAuth, async (c) => {
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

        const folderPath = `product-sellers/${userId}/profile`;
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
    
    const pathAfterUpload = parts.slice(uploadIndex + 1).join('/');
    const withoutVersion = pathAfterUpload.replace(/^v\d+\//, '');
    return withoutVersion.replace(/\.[^/.]+$/, '');
};

// Create/Update product seller profile
app.put('/', productSellerRoleAuth, async (c) => {
    try {
        const jwtUser = c.get('user') as { id: string };
        const userId = parseInt(jwtUser.id, 10);

        const data = await c.req.json();
        
        // Convert coordinates
        const latitude = data.latitude !== null && data.latitude !== undefined 
            ? String(data.latitude) 
            : null;
        const longitude = data.longitude !== null && data.longitude !== undefined 
            ? String(data.longitude) 
            : null;

        const existingProfile = await db.query.productSellers.findFirst({
            where: eq(productSellers.userId, userId),
        });

        let productSeller;
        if (existingProfile) {
            // Delete old profile image logic...
            [productSeller] = await db
                .update(productSellers)
                .set({
                    firstName: data.firstName,
                    lastName: data.lastName,
                    phoneNumber: data.phoneNumber,
                    collegeId: data.collegeId,
                    latitude: latitude,
                    longitude: longitude,
                    address: data.address,
                    bio: data.bio,
                    profileImageUrl: data.profileImageUrl,
                    isProfileComplete: true,
                    updatedAt: new Date(),
                })
                .where(eq(productSellers.userId, userId))
                .returning();
        } else {
            [productSeller] = await db
                .insert(productSellers)
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
                })
                .returning();
        }

        // FIX: Instead of trying to fetch with relations, manually fetch related data
        const college = data.collegeId ? await db.query.colleges.findFirst({
            where: eq(colleges.id, data.collegeId)
        }) : null;

        const userProducts = await db.query.products.findMany({
            where: eq(products.sellerId, productSeller.id)
        });

        return c.json({
            id: productSeller.id,
            userId: productSeller.userId,
            firstName: productSeller.firstName,
            lastName: productSeller.lastName,
            phoneNumber: productSeller.phoneNumber,
            collegeId: productSeller.collegeId,
            latitude: productSeller.latitude,
            longitude: productSeller.longitude,
            address: productSeller.address,
            bio: productSeller.bio,
            profileImageUrl: productSeller.profileImageUrl,
            isProfileComplete: productSeller.isProfileComplete,
            rating: productSeller.rating,
            completedSales: productSeller.completedSales,
            createdAt: productSeller.createdAt,
            updatedAt: productSeller.updatedAt,
            college: college,  // Manually added
            products: userProducts,  // Manually added
        });
        
    } catch (error) {
        console.error('Error in product seller PUT /:', error);
        return c.json({ 
            error: 'Internal server error',
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});


// Get all product sellers (public route - no auth required)

app.get('/all', async (c: Context<CustomContext>) => {
    try {
        const { collegeId, search } = c.req.query();

        // Build conditions array - always starts with at least one condition
        const conditions: SQL<unknown>[] = [eq(productSellers.isProfileComplete, true)];
        
        // Add college filter if provided
        if (collegeId) {
            conditions.push(eq(productSellers.collegeId, parseInt(collegeId)));
        }
        
        // Add search filter if provided
if (search) {
    const searchTerm = String(search).trim();
    if (searchTerm) {
        conditions.push(
            or(
                like(productSellers.firstName, `%${searchTerm}%`),
                like(productSellers.lastName, `%${searchTerm}%`),
                like(productSellers.bio, `%${searchTerm}%`)
            ) as SQL<unknown> // Explicit cast if needed
        );
    }
}

        const results = await db.query.productSellers.findMany({
            // Use non-null assertion to tell TypeScript conditions[0] is definitely not undefined
            where: conditions.length === 1 ? conditions[0]! : and(...conditions),
            with: {
                college: true,
                products: {
                    where: eq(products.isActive, true),
                },
            },
        });

        const transformedResults = results.map(seller => ({
            ...seller,
            latitude: seller.latitude !== null ? Number(seller.latitude) : null,
            longitude: seller.longitude !== null ? Number(seller.longitude) : null,
        }));

        return c.json({
            success: true,
            data: transformedResults
        });

    } catch (error) {
        console.error('Error fetching product sellers:', error);
        return c.json({ 
            success: false,
            error: 'Failed to fetch product sellers',
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});
// Get a specific product seller's public profile
app.get('/:id', async (c: Context<CustomContext>) => {
    try {
        const sellerId = parseInt(c.req.param('id'));

        const productSeller = await db.query.productSellers.findFirst({
            where: and(
                eq(productSellers.id, sellerId),
                eq(productSellers.isProfileComplete, true)
            ),
            with: {
                college: true,
                products: {
                    where: eq(products.isActive, true),
                },
            },
        });

        if (!productSeller) {
            return c.json({ 
                success: false,
                error: 'Product seller not found or profile incomplete'
            }, 404);
        }

        return c.json({
            success: true,
            data: {
                id: productSeller.id,
                firstName: productSeller.firstName,
                lastName: productSeller.lastName,
                phoneNumber: productSeller.phoneNumber,
                collegeId: productSeller.collegeId,
                latitude: productSeller.latitude !== null ? Number(productSeller.latitude) : null,
                longitude: productSeller.longitude !== null ? Number(productSeller.longitude) : null,
                address: productSeller.address,
                bio: productSeller.bio,
                rating: productSeller.rating,
                completedSales: productSeller.completedSales,
                profileImageUrl: productSeller.profileImageUrl,
                college: productSeller.college,
                products: productSeller.products,
            }
        });

    } catch (error) {
        console.error('Error fetching product seller:', error);
        return c.json({ 
            success: false,
            error: 'Failed to fetch product seller',
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

export default app;