import { Hono } from 'hono';
import { eq, and, desc, ilike, or, gte, lte, inArray } from 'drizzle-orm';
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
    // Build conditions array
    const conditions = [
      eq(products.status, 'published'),
      products.stock === null ? undefined : gte(products.stock, 1)
    ].filter(Boolean); // Remove undefined conditions

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

    // First, get the filtered products without images
    const filteredProducts = await db.select({
      id: products.id,
      name: products.name,
      description: products.description,
      price: products.price,
      category: products.category,
      stock: products.stock,
      createdAt: products.createdAt,
      provider: {
        id: providers.id,
        firstName: providers.firstName,
        lastName: providers.lastName,
        rating: providers.rating,
        collegeId: providers.collegeId,
        profileImageUrl: providers.profileImageUrl
      }
    })
    .from(products)
    .leftJoin(providers, eq(products.providerId, providers.id))
    .where(and(...conditions))
    .orderBy(desc(products.createdAt));

    // If no products found, return early
    if (filteredProducts.length === 0) {
      return c.json([]);
    }

    // Get product IDs for image fetching
    const productIds = filteredProducts.map(p => p.id);

    // Fetch images separately
    const images = await db.select({
      productId: productImages.productId,
      url: productImages.url
    })
    .from(productImages)
    .where(inArray(productImages.productId, productIds));

    // Group images by product
    const imagesByProduct = images.reduce((acc, img) => {
      if (!acc[img.productId]) {
        acc[img.productId] = [];
      }
      acc[img.productId].push(img.url);
      return acc;
    }, {} as Record<number, string[]>);

    // Combine products with their images
    const productsWithImages = filteredProducts.map(product => ({
      ...product,
      images: imagesByProduct[product.id] || []
    }));

    return c.json(productsWithImages);
  } catch (error) {
    console.error('Error fetching products:', error);
    return c.json({ error: 'Failed to fetch products' }, 500);
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