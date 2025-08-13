import { Hono } from 'hono';
import { eq, and, desc, ilike, or, gte, lte, inArray,isNull } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { 
  products, 
  productImages, 
  productSales,
  colleges,
  users,
  providers
} from '../../drizzle/schema.js';
import { authMiddleware } from '../../middleware/bearAuth.js';
import { ValidationError } from '../../utils/error.js';

const clientProducts = new Hono()
  .use('*', authMiddleware);



// Get all published products with filters
clientProducts.get('/', async (c) => {
  const { search, category, minPrice, maxPrice, collegeId } = c.req.query();
  const baseUrl = process.env.BASE_URL || 'https://mkt-backend-sz2s.onrender.com';

  try {
    // 1. Build query conditions
    const conditions = [
      eq(products.status, 'published'),
      or(
        isNull(products.stock),
        gte(products.stock, 1)
      )
    ];

    // Add search filter
    if (search) {
      conditions.push(
        or(
          ilike(products.name, `%${search}%`),
          ilike(products.description, `%${search}%`),
          ilike(products.category, `%${search}%`)
        )
      );
    }

    // Add category filter
    if (category) {
      conditions.push(eq(products.category, category));
    }

    // Add price filters
    if (minPrice) {
      const min = parseFloat(minPrice);
      if (!isNaN(min)) {
        conditions.push(gte(products.price, min.toString()));
      }
    }

    if (maxPrice) {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) {
        conditions.push(lte(products.price, max.toString()));
      }
    }

    // Add college filter if valid collegeId is provided
    if (collegeId && !isNaN(parseInt(collegeId))) {
      conditions.push(eq(providers.collegeId, parseInt(collegeId)));
    }

    // 2. Fetch products with their relationships
    const results = await db
      .select({
        product: products,
        imageUrl: productImages.url,
        provider: providers,
        collegeName: colleges.name,
        collegeLocation: colleges.location
      })
      .from(products)
      .leftJoin(productImages, eq(products.id, productImages.productId))
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(colleges, eq(providers.collegeId, colleges.id))
      .where(and(...conditions))
      .orderBy(desc(products.createdAt));

    if (results.length === 0) return c.json([]);

    // 3. Group products with their images
    const productsMap = new Map<number, any>();
    
    results.forEach(row => {
      if (!productsMap.has(row.product.id)) {
        productsMap.set(row.product.id, {
          ...row.product,
          images: [],
          provider: row.provider ? {
            id: row.provider.id,
            firstName: row.provider.firstName,
            lastName: row.provider.lastName,
            rating: row.provider.rating,
            collegeId: row.provider.collegeId,
            profileImageUrl: row.provider.profileImageUrl
              ? normalizeUrl(row.provider.profileImageUrl, baseUrl)
              : null,
            bio: row.provider.bio,
            completedRequests: row.provider.completedRequests,
            college: row.collegeName ? {
              name: row.collegeName,
              location: row.collegeLocation
            } : null
          } : "Unknown Provider"
        });
      }

      if (row.imageUrl) {
        const product = productsMap.get(row.product.id);
        product.images.push(normalizeUrl(row.imageUrl, baseUrl));
      }
    });

    return c.json(Array.from(productsMap.values()));

  } catch (error: unknown) {
    console.error('Error in /api/products:', error);
    return c.json({
      error: 'Failed to fetch products',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});


// URL normalization helper function
function normalizeUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  
  // Already absolute URL
  if (url.startsWith('http')) return url;
  
  // Cloudinary URL (special case)
  if (url.includes('res.cloudinary.com')) return url;
  
  // Ensure proper formatting for local paths
  return url.startsWith('/')
    ? `${baseUrl}${url}`
    : `${baseUrl}/${url}`;
}

// Get product details
clientProducts.get('/:id', async (c) => {
  const productId = parseInt(c.req.param('id'));
  if (isNaN(productId)) {
    return c.json({ error: 'Invalid product ID' }, 400);
  }

  try {
    const product = await db.query.products.findFirst({
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
        provider: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            rating: true,
            collegeId: true,
            profileImageUrl: true,
            bio: true,
            completedRequests: true
          },
          with: {
            college: {
              columns: {
                name: true,
                location: true
              }
            }
          }
        }
      }
    });

    if (!product) {
      return c.json({ error: 'Product not found' }, 404);
    }

    return c.json({
      ...product,
      images: product.images.map(img => img.url)
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    return c.json({ error: 'Failed to fetch product' }, 500);
  }
});

// Create a new sale (purchase)
clientProducts.post('/:id/purchase', async (c) => {
  const user = c.get('user');
  const productId = parseInt(c.req.param('id'));
  if (isNaN(productId)) {
    return c.json({ error: 'Invalid product ID' }, 400);
  }

  const { quantity, paymentMethod, shippingAddress } = await c.req.json();

  if (!quantity || quantity < 1) {
    return c.json({ error: 'Invalid quantity' }, 400);
  }

  // Convert user.id to number if it's a string
  const customerId = typeof user.id === 'string' ? parseInt(user.id) : user.id;
  if (isNaN(customerId)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  // Ensure quantity is a number
  const purchaseQuantity = parseInt(quantity);
  if (isNaN(purchaseQuantity) || purchaseQuantity < 1) {
    return c.json({ error: 'Invalid quantity' }, 400);
  }

  try {
    // Start transaction
    const result = await db.transaction(async (tx) => {
      // 1. Get product with lock to prevent race conditions
      const product = await tx.query.products.findFirst({
        where: and(
          eq(products.id, productId),
          eq(products.status, 'published')
        ),
        with: {
          provider: {
            columns: {
              id: true
            }
          }
        }
      });

      if (!product) {
        throw new ValidationError('Product not available');
      }

      // 2. Check stock if applicable
      if (product.stock !== null && product.stock < purchaseQuantity) {
        throw new ValidationError('Insufficient stock');
      }

      // 3. Calculate total price
      const price = parseFloat(product.price);
      if (isNaN(price)) {
        throw new ValidationError('Invalid product price');
      }
      const totalPrice = (price * purchaseQuantity).toFixed(2);

      // 4. Create sale record
      const [sale] = await tx.insert(productSales).values({
        productId: productId,
        providerId: product.provider.id,
        customerId: customerId, // Now guaranteed to be a number
        quantity: purchaseQuantity, // Now guaranteed to be a number
        totalPrice: totalPrice, // String representation of the decimal
        paymentMethod: paymentMethod,
        shippingAddress: shippingAddress,
        status: 'pending'
      }).returning();

      // 5. Update stock if applicable
      if (product.stock !== null) {
        await tx.update(products)
          .set({ stock: product.stock - purchaseQuantity })
          .where(eq(products.id, productId));
      }

      return sale;
    });

    return c.json(result, 201);
  } catch (error) {
    console.error('Error processing purchase:', error);
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: 'Failed to process purchase' }, 500);
  }
});

// Get user's purchase history
clientProducts.get('/purchases/history', async (c) => {
  const user = c.get('user');
  
  // Convert userId to number if it's a string
  const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;
  
  if (isNaN(userId)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  try {
    const purchases = await db.query.productSales.findMany({
      where: eq(productSales.customerId, userId), // Now userId is guaranteed to be a number
      orderBy: [desc(productSales.createdAt)],
      with: {
        product: {
          columns: {
            name: true,
            price: true
          },
          with: {
            images: {
              columns: {
                url: true
              },
              limit: 1
            },
            provider: {
              columns: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    const formatted = purchases.map(purchase => ({
      id: purchase.id,
      product: {
        name: purchase.product?.name || 'Unknown Product',
        price: purchase.product?.price || '0',
        image: purchase.product?.images?.[0]?.url || '/default-product.png',
        provider: purchase.product?.provider 
          ? `${purchase.product.provider.firstName} ${purchase.product.provider.lastName}`
          : 'Unknown Provider'
      },
      quantity: purchase.quantity,
      totalPrice: purchase.totalPrice,
      status: purchase.status,
      createdAt: purchase.createdAt
    }));

    return c.json(formatted);
  } catch (error) {
    console.error('Error fetching purchase history:', error);
    return c.json({ error: 'Failed to fetch purchase history' }, 500);
  }
});

export default clientProducts;