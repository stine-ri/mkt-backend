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
// Replace your entire GET '/' endpoint with this:
clientProducts.get('/', async (c) => {
  const { search, category, minPrice, maxPrice, collegeId } = c.req.query();
  const baseUrl = process.env.BASE_URL || 'https://mkt-backend-sz2s.onrender.com';

  try {
    // Build the WHERE conditions for the main query
    const whereConditions = [];
    
    // Base conditions
    whereConditions.push(eq(products.status, 'published'));
    whereConditions.push(
      or(
        isNull(products.stock),
        gte(products.stock, 1)
      )
    );

    // Search filter
    if (search) {
      whereConditions.push(
        or(
          ilike(products.name, `%${search}%`),
          ilike(products.description, `%${search}%`),
          ilike(products.category, `%${search}%`)
        )
      );
    }

    // Category filter
    if (category) {
      whereConditions.push(eq(products.category, category));
    }

    // Price filters
    if (minPrice) {
      const min = parseFloat(minPrice);
      if (!isNaN(min)) {
        whereConditions.push(gte(products.price, min.toString()));
      }
    }

    if (maxPrice) {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) {
        whereConditions.push(lte(products.price, max.toString()));
      }
    }

    console.log('Fetching products with relations...');

    // Use the SAME query pattern as your working detail endpoint
    const productsWithRelations = await db.query.products.findMany({
      where: and(...whereConditions),
      orderBy: [desc(products.createdAt)],
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

    console.log(`Found ${productsWithRelations.length} products`);
    console.log('Sample product images:', productsWithRelations.slice(0, 2).map(p => ({
      id: p.id,
      name: p.name,
      imageCount: p.images?.length || 0,
      images: p.images?.map(img => img.url) || []
    })));

    // Apply college filter if needed (post-query filtering)
    let filteredProducts = productsWithRelations;
    if (collegeId && !isNaN(parseInt(collegeId))) {
      const targetCollegeId = parseInt(collegeId);
      filteredProducts = productsWithRelations.filter(
        product => product.provider?.collegeId === targetCollegeId
      );
      console.log(`Filtered to ${filteredProducts.length} products for college ${targetCollegeId}`);
    }

    // Transform the response to match your expected format
    const transformedProducts = filteredProducts.map(product => {
      const imageUrls = product.images.map(img => normalizeUrl(img.url, baseUrl));
      
      return {
        id: product.id,
        providerId: product.providerId,
        name: product.name,
        description: product.description,
        price: product.price,
        category: product.category,
        stock: product.stock,
        status: product.status,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        images: imageUrls, // This is the key fix!
        provider: product.provider ? {
          id: product.provider.id,
          firstName: product.provider.firstName,
          lastName: product.provider.lastName,
          rating: product.provider.rating,
          collegeId: product.provider.collegeId,
          profileImageUrl: product.provider.profileImageUrl
            ? normalizeUrl(product.provider.profileImageUrl, baseUrl)
            : null,
          bio: product.provider.bio,
          completedRequests: product.provider.completedRequests,
          college: product.provider.college ? {
            name: product.provider.college.name,
            location: product.provider.college.location
          } : null
        } : "Unknown Provider"
      };
    });

    console.log('Final response sample:', transformedProducts.slice(0, 2).map(p => ({
      id: p.id,
      name: p.name,
      imageCount: p.images.length,
      firstImage: p.images[0]
    })));

    return c.json(transformedProducts);

  } catch (error: unknown) {
    console.error('Error in /api/products:', error);
    return c.json({
      error: 'Failed to fetch products',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
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