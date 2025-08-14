import { Hono } from 'hono';
import { eq, and, desc, ilike, or, gte, lte, inArray,isNull,sql } from 'drizzle-orm';
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
// Fixed version of your products endpoint
clientProducts.get('/', async (c) => {
  try {
    // First, let's get products and their images with a raw query
    const rawResults = await db.execute(sql`
      SELECT 
        p.id as product_id,
        p.name,
        p.description,
        p.price,
        p.category,
        p.stock,
        p.status,
        p.created_at,
        pi.url as image_url,
        pr.id as provider_id,
        pr.first_name,
        pr.last_name,
        pr.rating,
        pr.college_id,
        pr.profile_image_url,
        pr.bio,
        pr.completed_requests,
        c.name as college_name,
        c.location as college_location
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      LEFT JOIN providers pr ON p.provider_id = pr.id
      LEFT JOIN colleges c ON pr.college_id = c.id
      WHERE p.status = 'published'
      AND (p.stock IS NULL OR p.stock >= 1)
      ORDER BY p.created_at DESC
    `);

    console.log('Raw SQL results:', rawResults.rows.length);
    console.log('First few rows:', rawResults.rows.slice(0, 3));

    // Group the results
    const productsMap = new Map();
    
    rawResults.rows.forEach(row => {
      const productId = row.product_id;
      
      if (!productsMap.has(productId)) {
        productsMap.set(productId, {
          id: productId,
          name: row.name,
          description: row.description,
          price: row.price,
          category: row.category,
          stock: row.stock,
          status: row.status,
          createdAt: row.created_at,
          images: [],
          provider: {
            id: row.provider_id,
            firstName: row.first_name,
            lastName: row.last_name,
            rating: row.rating,
            collegeId: row.college_id,
            profileImageUrl: row.profile_image_url,
            bio: row.bio,
            completedRequests: row.completed_requests,
            college: row.college_name ? {
              name: row.college_name,
              location: row.college_location
            } : null
          }
        });
      }

      if (row.image_url) {
        const product = productsMap.get(productId);
        product.images.push(row.image_url);
      }
    });

    const finalProducts = Array.from(productsMap.values());
    console.log('Final grouped products:', finalProducts.map(p => ({
      id: p.id,
      name: p.name,
      imageCount: p.images.length
    })));

    return c.json(finalProducts);

  } catch (error) {
  console.error('Raw SQL error:', error);
  
  if (error instanceof Error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ error: String(error) }, 500);
}

});

// Make sure your normalizeUrl function is working correctly
function normalizeUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  
  console.log('Normalizing URL:', { input: url, baseUrl });
  
  // Already absolute URL
  if (url.startsWith('http')) {
    console.log('Already absolute:', url);
    return url;
  }
  
  // Cloudinary URL (special case)
  if (url.includes('res.cloudinary.com')) {
    const fullUrl = url.startsWith('https://') ? url : `https://${url}`;
    console.log('Cloudinary URL:', fullUrl);
    return fullUrl;
  }
  
  // Ensure proper formatting for local paths
  const result = url.startsWith('/')
    ? `${baseUrl}${url}`
    : `${baseUrl}/${url}`;
  
  console.log('Local URL normalized:', result);
  return result;
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