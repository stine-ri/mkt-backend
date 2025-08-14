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
clientProducts.get('/', async (c) => {
  const { search, category, minPrice, maxPrice, collegeId } = c.req.query();
  const baseUrl = process.env.BASE_URL || 'https://mkt-backend-sz2s.onrender.com';

  console.log('=== NEW PRODUCTS ENDPOINT CALLED ===');
  console.log('Filters:', { search, category, minPrice, maxPrice, collegeId });

  try {
    // Build WHERE conditions
    const whereConditions = [];
    
    whereConditions.push(eq(products.status, 'published'));
    whereConditions.push(
      or(
        isNull(products.stock),
        gte(products.stock, 1)
      )
    );

    if (search) {
      whereConditions.push(
        or(
          ilike(products.name, `%${search}%`),
          ilike(products.description, `%${search}%`),
          ilike(products.category, `%${search}%`)
        )
      );
    }

    if (category) {
      whereConditions.push(eq(products.category, category));
    }

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

    console.log('About to run relation-based query...');

    // Use relation-based query (same as detail endpoint)
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

    console.log(`✅ Query completed. Found ${productsWithRelations.length} products`);
    
    // Log first product to verify images
    if (productsWithRelations.length > 0) {
      const firstProduct = productsWithRelations[0];
      console.log('First product sample:', {
        id: firstProduct.id,
        name: firstProduct.name,
        imageCount: firstProduct.images?.length || 0,
        imageUrls: firstProduct.images?.map(img => img.url) || []
      });
    }

    // Apply college filter if needed
    let filteredProducts = productsWithRelations;
    if (collegeId && !isNaN(parseInt(collegeId))) {
      const targetCollegeId = parseInt(collegeId);
      filteredProducts = productsWithRelations.filter(
        product => product.provider?.collegeId === targetCollegeId
      );
      console.log(`College filter applied: ${filteredProducts.length} products remain`);
    }

    // Transform response
    const transformedProducts = filteredProducts.map(product => ({
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
      images: product.images.map(img => normalizeUrl(img.url, baseUrl)),
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
    }));

    console.log('Final response:', transformedProducts.map(p => ({
      id: p.id,
      name: p.name,
      imageCount: p.images.length,
      firstImageUrl: p.images[0] || 'NO IMAGE'
    })));

    return c.json(transformedProducts);

  } catch (error) {
    console.error('❌ Error in new products endpoint:', error);
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
// Enhanced backend endpoint with detailed error logging
clientProducts.post('/:id/purchase', async (c) => {
  const user = c.get('user');
  const productId = parseInt(c.req.param('id'));
  
  console.log('=== Purchase Request Debug ===');
  console.log('User:', user);
  console.log('Product ID:', productId);
  
  if (isNaN(productId)) {
    console.log('ERROR: Invalid product ID');
    return c.json({ error: 'Invalid product ID' }, 400);
  }

  let requestBody;
  try {
    requestBody = await c.req.json();
    console.log('Request body:', requestBody);
  } catch (error) {
    console.log('ERROR: Failed to parse request body:', error);
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const { quantity, paymentMethod, shippingAddress } = requestBody;

  console.log('Parsed values:', { quantity, paymentMethod, shippingAddress });

  if (!quantity || quantity < 1) {
    console.log('ERROR: Invalid quantity:', quantity);
    return c.json({ error: 'Invalid quantity' }, 400);
  }

  // Convert user.id to number if it's a string
  const customerId = typeof user.id === 'string' ? parseInt(user.id) : user.id;
  console.log('Customer ID conversion:', { original: user.id, converted: customerId });
  
  if (isNaN(customerId)) {
    console.log('ERROR: Invalid user ID after conversion');
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  // Ensure quantity is a number
  const purchaseQuantity = parseInt(quantity);
  console.log('Quantity conversion:', { original: quantity, converted: purchaseQuantity });
  
  if (isNaN(purchaseQuantity) || purchaseQuantity < 1) {
    console.log('ERROR: Invalid quantity after conversion');
    return c.json({ error: 'Invalid quantity' }, 400);
  }

  try {
    // Start transaction
    console.log('Starting database transaction...');
    const result = await db.transaction(async (tx) => {
      console.log('Inside transaction - looking for product...');
      
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

      console.log('Product found:', product);

      if (!product) {
        console.log('ERROR: Product not found or not published');
        throw new ValidationError('Product not available');
      }

      console.log('Provider info:', product.provider);

      // 2. Check stock if applicable
      if (product.stock !== null && product.stock < purchaseQuantity) {
        console.log('ERROR: Insufficient stock:', { available: product.stock, requested: purchaseQuantity });
        throw new ValidationError('Insufficient stock');
      }

      // 3. Calculate total price
      console.log('Product price (raw):', product.price);
      const price = parseFloat(product.price);
      console.log('Product price (parsed):', price);
      
      if (isNaN(price)) {
        console.log('ERROR: Invalid product price');
        throw new ValidationError('Invalid product price');
      }
      
      const totalPrice = (price * purchaseQuantity).toFixed(2);
      console.log('Total price calculated:', totalPrice);

      // 4. Create sale record
      console.log('Creating sale record with values:', {
        productId: productId,
        providerId: product.provider.id,
        customerId: customerId,
        quantity: purchaseQuantity,
        totalPrice: totalPrice,
        paymentMethod: paymentMethod,
        shippingAddress: shippingAddress,
        status: 'pending'
      });

      const [sale] = await tx.insert(productSales).values({
        productId: productId,
        providerId: product.provider.id,
        customerId: customerId,
        quantity: purchaseQuantity,
        totalPrice: totalPrice,
        paymentMethod: paymentMethod,
        shippingAddress: shippingAddress,
        status: 'pending'
      }).returning();

      console.log('Sale created:', sale);

      // 5. Update stock if applicable
      if (product.stock !== null) {
        console.log('Updating stock from', product.stock, 'to', product.stock - purchaseQuantity);
        await tx.update(products)
          .set({ stock: product.stock - purchaseQuantity })
          .where(eq(products.id, productId));
        console.log('Stock updated successfully');
      }

      return sale;
    });

    console.log('Transaction completed successfully:', result);
    return c.json(result, 201);
    
  } catch (error) {
  console.error('=== DETAILED ERROR INFO ===');

  if (error instanceof Error) {
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
  } else {
    console.error('Unknown error:', error);
  }

  console.error('===========================');

  if (error instanceof ValidationError) {
    return c.json({ error: error.message }, 400);
  }

  if (process.env.NODE_ENV === 'development' && error instanceof Error) {
    return c.json({ 
      error: 'Failed to process purchase', 
      details: error.message,
      stack: error.stack 
    }, 500);
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