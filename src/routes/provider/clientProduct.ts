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
    // 1. Build conditions array
    const conditions = [
      eq(products.status, 'published'),
      or(
        isNull(products.stock),  // Include items with NULL stock
        gte(products.stock, 1)   // Or stock >= 1
      )
    ];

    // Add search filter if provided
    if (search) {
      conditions.push(
        or(
          ilike(products.name, `%${search}%`),
          ilike(products.description, `%${search}%`),
          ilike(products.category, `%${search}%`)
        )
      );
    }

    // Add category filter if provided
    if (category) {
      conditions.push(eq(products.category, category));
    }

    // Add price filters if provided
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

    // Add college filter if provided
    if (collegeId) {
      const college = parseInt(collegeId);
      if (!isNaN(college)) {
        conditions.push(eq(providers.collegeId, college));
      }
    }

    // 2. First query - get products with provider info
    const filteredProducts = await db.select({
      id: products.id,
      name: products.name,
      description: products.description,
      price: products.price,
      category: products.category,
      stock: products.stock,
      createdAt: products.createdAt,
      providerId: products.providerId,
      // Get provider fields individually to avoid nesting issues
      providerFirstName: providers.firstName,
      providerLastName: providers.lastName,
      providerRating: providers.rating,
      providerCollegeId: providers.collegeId,
      providerProfileImageUrl: providers.profileImageUrl,
      providerIdField: providers.id
    })
    .from(products)
    .leftJoin(providers, eq(products.providerId, providers.id))
    .where(and(...conditions))
    .orderBy(desc(products.createdAt));

    // Early return if no products found
    if (filteredProducts.length === 0) {
      return c.json([]);
    }

    // 3. Second query - get all images for these products
    const productIds = filteredProducts.map(p => p.id);
    
    console.log('=== IMAGE QUERY DEBUG ===');
    console.log('Product IDs to query:', productIds);
    console.log('Products found:', filteredProducts.length);
    
    // First, let's check if ANY images exist in the table
    const allImages = await db.select({
      productId: productImages.productId,
      url: productImages.url,
      isPrimary: productImages.isPrimary
    })
    .from(productImages);
    
    console.log('Total images in database:', allImages.length);
    console.log('All images:', allImages);
    
    const imageData = await db.select({
      productId: productImages.productId,
      url: productImages.url,
      isPrimary: productImages.isPrimary
    })
    .from(productImages)
    .where(inArray(productImages.productId, productIds));
    
    console.log('Images for our products:', imageData);
    console.log('Image query returned:', imageData.length, 'images');

    // 4. Process and normalize image URLs
    const baseUrl = process.env.BASE_URL || 'https://mkt-backend-sz2s.onrender.com';
    
    // Type for the accumulator object
    type ImagesByProduct = Record<number, string[]>;
    
    const imagesByProductId: ImagesByProduct = imageData.reduce(
      (acc: ImagesByProduct, image: { productId: number; url: string; isPrimary: boolean | null }) => {
        if (!acc[image.productId]) {
          acc[image.productId] = [];
        }

        // Normalize URL format - handle different storage methods
        let imageUrl = image.url;
        
        // Skip invalid or empty URLs
        if (!imageUrl || imageUrl.trim() === '') {
          console.log(`Skipping empty URL for product ${image.productId}`);
          return acc;
        }
        
        // If it's already a full URL (Cloudinary, AWS, etc.), use as is
        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
          console.log(`Using external URL for product ${image.productId}:`, imageUrl);
          // Prioritize primary images
          if (image.isPrimary === true) {
            acc[image.productId].unshift(imageUrl);
          } else {
            acc[image.productId].push(imageUrl);
          }
        } else {
          // Local file storage - normalize the path
          const cleanPath = imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl;
          const normalizedUrl = `${baseUrl}/${cleanPath}`;
          console.log(`Normalized local URL for product ${image.productId}:`, normalizedUrl);
          
          // Prioritize primary images
          if (image.isPrimary === true) {
            acc[image.productId].unshift(normalizedUrl);
          } else {
            acc[image.productId].push(normalizedUrl);
          }
        }

        return acc;
      }, 
      {} as ImagesByProduct
    );
    
    console.log('Final imagesByProductId:', imagesByProductId);

    // 5. Combine products with their images
    const result = filteredProducts.map(product => {
      const productImages = imagesByProductId[product.id] || [];
      
      return {
        ...product,
        images: productImages, // For details view (all images)
        image: productImages[0] || null, // For list view (primary/first image)
        primaryImage: productImages[0] || null, // Alternative naming
        imageUrl: productImages[0] || null, // Another common naming
        provider: product.providerIdField ? {
          id: product.providerIdField,
          firstName: product.providerFirstName,
          lastName: product.providerLastName,
          rating: product.providerRating,
          collegeId: product.providerCollegeId,
          profileImageUrl: product.providerProfileImageUrl
            ? product.providerProfileImageUrl.startsWith('http')
              ? product.providerProfileImageUrl
              : `${baseUrl}${product.providerProfileImageUrl}`
            : null
        } : null
      };
    });

    // Debug logs (can remove in production)
    console.log('Filtered products count:', filteredProducts.length);
    console.log('Product IDs being queried for images:', productIds);
    console.log('Image data from database:', imageData);
    console.log('Images grouped by product ID:', imagesByProductId);
    console.log('Product 13 data:', result.find(p => p.id === 13));
    console.log('Total products returned:', result.length);

    return c.json(result);
    
  } catch (error) {
    console.error('Error fetching products:', error);
    
    // Enhanced error response
    return c.json({ 
      error: 'Failed to fetch products',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: process.env.NODE_ENV === 'development' 
        ? error instanceof Error ? error.stack : undefined 
        : undefined
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