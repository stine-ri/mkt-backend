import { Hono } from 'hono';
import { eq, desc, ilike, or, and, SQL } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { products, productImages, providers, categories } from '../../drizzle/schema.js';

const publicProduct = new Hono();

// Public endpoint to get all published products 
publicProduct.get('/', async (c) => {
  try {
    // Always fetch all published products - let frontend handle filtering
    const result = await db.query.products.findMany({
      where: eq(products.status, 'published'),
      orderBy: [desc(products.createdAt)],
      with: {
        images: {
          columns: {
            url: true
          }
        },
        category: {
          columns: {
            id: true,
            name: true,
            description: true
          }
        },
        provider: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true, // Added phone number
            rating: true,
            profileImageUrl: true
          }
        }
      }
    });

    const formatted = result.map((product) => ({
      ...product,
      // Keep the original categoryId for proper filtering
      categoryId: product.categoryId,
      // Provide category name for display
      categoryName: product.category?.name || 'Uncategorized',
      // Format images array
      images: product.images.map(img => img.url),
      // Format provider info
      provider: {
        id: product.provider?.id,
        firstName: product.provider?.firstName || '',
        lastName: product.provider?.lastName || '',
        phone: product.provider?.phoneNumber || '', // Added phone
        rating: product.provider?.rating,
        profileImageUrl: product.provider?.profileImageUrl
      }
    }));

    return c.json(formatted);
  } catch (error) {
    console.error('Error fetching public products:', error);
    return c.json({ error: 'Failed to fetch products' }, 500);
  }
});

// Public search endpoint 
publicProduct.get('/search', async (c) => {
  try {
    const search = c.req.query('q');
    const category = c.req.query('category');
    
    let whereConditions = eq(products.status, 'published');

    if (search) {
      // Search in products and categories
      const searchResults = await db.select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        categoryId: products.categoryId,
        stock: products.stock,
        status: products.status,
        providerId: products.providerId,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        categoryName: categories.name,
        categoryDescription: categories.description,
        providerFirstName: providers.firstName,
        providerLastName: providers.lastName,
        providerPhone: providers.phoneNumber, // Added phone number
        providerRating: providers.rating,
        providerProfileImage: providers.profileImageUrl
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(providers, eq(products.providerId, providers.id))
      .where(and(
        eq(products.status, 'published'),
        or(
          ilike(products.name, `%${search}%`),
          ilike(products.description, `%${search}%`),
          ilike(categories.name, `%${search}%`),
          ilike(providers.firstName, `%${search}%`),
          ilike(providers.lastName, `%${search}%`)
        )
      ))
      .orderBy(desc(products.createdAt));

      // Get product IDs for image fetching
      const productIds = searchResults.map(p => p.id);
      
      // Fetch images for these products
      const images = productIds.length > 0 ? await db.select()
        .from(productImages)
        .where(or(...productIds.map(id => eq(productImages.productId, id))))
        : [];

      // Group images by product
      const imageMap = new Map();
      images.forEach(img => {
        if (!imageMap.has(img.productId)) {
          imageMap.set(img.productId, []);
        }
        imageMap.get(img.productId).push(img.url);
      });

      const formatted = searchResults.map(product => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        categoryId: product.categoryId,
        stock: product.stock,
        status: product.status,
        providerId: product.providerId,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        categoryName: product.categoryName || 'Uncategorized',
        images: imageMap.get(product.id) || [],
        provider: {
          firstName: product.providerFirstName || '',
          lastName: product.providerLastName || '',
          phone: product.providerPhone || '', // Added phone
          rating: product.providerRating,
          profileImageUrl: product.providerProfileImage
        }
      }));

      return c.json(formatted);
    }

    // No search parameters, return all published products
    const result = await db.query.products.findMany({
      where: eq(products.status, 'published'),
      orderBy: [desc(products.createdAt)],
      with: {
        images: {
          columns: {
            url: true
          }
        },
        category: {
          columns: {
            id: true,
            name: true,
            description: true
          }
        },
        provider: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true, // Added phone number
            rating: true,
            profileImageUrl: true
          }
        }
      }
    });

    const formatted = result.map((product) => ({
      ...product,
      categoryId: product.categoryId,
      categoryName: product.category?.name || 'Uncategorized',
      images: product.images.map(img => img.url),
      provider: {
        id: product.provider?.id,
        firstName: product.provider?.firstName || '',
        lastName: product.provider?.lastName || '',
        phone: product.provider?.phoneNumber || '', // Added phone
        rating: product.provider?.rating,
        profileImageUrl: product.provider?.profileImageUrl
      }
    }));

    return c.json(formatted);
  } catch (error) {
    console.error('Error searching products:', error);
    return c.json({ error: 'Failed to search products' }, 500);
  }
});

// Get single product by ID (public)
publicProduct.get('/:id', async (c) => {
  try {
    const productId = parseInt(c.req.param('id'));
    
    if (isNaN(productId)) {
      return c.json({ error: 'Invalid product ID' }, 400);
    }

    const result = await db.query.products.findFirst({
      where: and(
        eq(products.id, productId),
        eq(products.status, 'published')
      ),
      with: {
        images: {
          columns: {
            url: true
          }
        },
        category: {
          columns: {
            id: true,
            name: true,
            description: true
          }
        },
        provider: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true, // Added phone number
            rating: true,
            profileImageUrl: true
          }
        }
      }
    });

    if (!result) {
      return c.json({ error: 'Product not found' }, 404);
    }

    const formatted = {
      ...result,
      categoryId: result.categoryId,
      categoryName: result.category?.name || 'Uncategorized',
      images: result.images.map(img => img.url),
      provider: {
        id: result.provider?.id,
        firstName: result.provider?.firstName || '',
        lastName: result.provider?.lastName || '',
        phone: result.provider?.phoneNumber || '', // Added phone
        rating: result.provider?.rating,
        profileImageUrl: result.provider?.profileImageUrl
      }
    };

    return c.json(formatted);
  } catch (error) {
    console.error('Error fetching product:', error);
    return c.json({ error: 'Failed to fetch product' }, 500);
  }
});

export default publicProduct;