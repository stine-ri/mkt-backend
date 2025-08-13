import { Hono } from 'hono';
import { eq, and, desc, ilike, or, gte, lte, inArray,isNull } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { 
  products, 
  productImages, 
  productSales,
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

    // Add college filter
    if (collegeId) {
      const college = parseInt(collegeId);
      if (!isNaN(college)) {
        conditions.push(eq(providers.collegeId, college));
      }
    }

    // 2. Get products with provider info
    const productResults = await db.select({
      id: products.id,
      name: products.name,
      description: products.description,
      price: products.price,
      category: products.category,
      stock: products.stock,
      createdAt: products.createdAt,
      providerId: products.providerId,
      providerIdField: providers.id,
      providerFirstName: providers.firstName,
      providerLastName: providers.lastName,
      providerRating: providers.rating,
      providerCollegeId: providers.collegeId,
      providerProfileImageUrl: providers.profileImageUrl
    })
    .from(products)
    .leftJoin(providers, eq(products.providerId, providers.id))
    .where(and(...conditions))
    .orderBy(desc(products.createdAt));

    if (productResults.length === 0) return c.json([]);

    // 3. Get all images for these products
    const productIds = productResults.map(p => p.id);
    console.log('Fetching images for product IDs:', productIds);
    
    const images = await db.select()
      .from(productImages)
      .where(inArray(productImages.productId, productIds));

    console.log('Found images:', images);

    // 4. Process image URLs
    const baseUrl = process.env.BASE_URL || 'https://mkt-backend-sz2s.onrender.com';
    const imagesByProductId: Record<number, string[]> = {};

    images.forEach(img => {
      if (!img.url) return;
      
      const productId = img.productId;
      if (!imagesByProductId[productId]) {
        imagesByProductId[productId] = [];
      }

      // Handle URL formatting
      let finalUrl = img.url;
      
      // If URL is already absolute, use as-is
      if (img.url.startsWith('http')) {
        imagesByProductId[productId].push(img.url);
        return;
      }
      
      // Ensure relative paths start with a slash
      if (!img.url.startsWith('/')) {
        finalUrl = `/${img.url}`;
      }
      
      // Prepend base URL for relative paths
      imagesByProductId[productId].push(`${baseUrl}${finalUrl}`);
    });

    console.log('Processed images:', imagesByProductId);

    // 5. Build the final response
    const responseData = productResults.map(product => {
      const provider = product.providerIdField ? {
        id: product.providerIdField,
        firstName: product.providerFirstName,
        lastName: product.providerLastName,
        rating: product.providerRating,
        collegeId: product.providerCollegeId,
        profileImageUrl: product.providerProfileImageUrl
          ? product.providerProfileImageUrl.startsWith('http')
            ? product.providerProfileImageUrl
            : `${baseUrl}${product.providerProfileImageUrl.startsWith('/') 
                ? product.providerProfileImageUrl 
                : `/${product.providerProfileImageUrl}`}`
          : null
      } : null;

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        category: product.category,
        stock: product.stock,
        status: 'published',
        createdAt: product.createdAt,
        updatedAt: product.createdAt,
        images: imagesByProductId[product.id] || [],
        provider: provider || "Unknown Provider"
      };
    });

    return c.json(responseData);

  } catch (error: unknown) {
    console.error('Error in /api/products:', error);
    return c.json({
      error: 'Failed to fetch products',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

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