import { Hono } from 'hono';
import { eq, desc, ilike, or, and, SQL } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { products, productImages, providers, categories } from '../../drizzle/schema.js';

const publicProduct = new Hono();

// Public endpoint to get all published products
publicProduct.get('/', async (c) => {
  try {
    const category = c.req.query('category'); // Add category parameter
    
     const conditions: SQL<unknown>[] = [eq(products.status, 'published')];
    
    // If category is specified and not 'all', add category filter
     if (category && category !== 'all') {
      const categoryId = parseInt(category);
      if (!isNaN(categoryId)) {
        conditions.push(eq(products.categoryId, categoryId));
      }
    }
    
      // Use the conditions array
    const whereConditions = conditions.length > 1 
      ? and(...conditions) 
      : conditions[0];
      
    const result = await db.query.products.findMany({
      where: whereConditions,
      orderBy: [desc(products.createdAt)],
      with: {
        images: {
          columns: {
            url: true
          }
        },
        category: {
          columns: {
            name: true,
            description: true
          }
        },
        provider: {
          columns: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    const formatted = result.map((product) => ({
      ...product,
      category: product.category?.name || 'Uncategorized',
      images: product.images.map(img => img.url),
      provider: product.provider 
        ? `${product.provider.firstName} ${product.provider.lastName}`
        : 'Unknown Provider'
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
    
    // Build conditions array
    const conditions = [eq(products.status, 'published')];

    if (search) {
      // For search, we'll need to use a raw query or join with categories
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
        categoryName: categories.name
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(
        eq(products.status, 'published'),
        or(
          ilike(products.name, `%${search}%`),
          ilike(products.description, `%${search}%`),
          ilike(categories.name, `%${search}%`)
        )
      ))
      .orderBy(desc(products.createdAt));

      // Get product IDs for image fetching
      const productIds = searchResults.map(p => p.id);
      
      // Fetch images for these products
      const images = await db.select()
        .from(productImages)
        .where(eq(productImages.productId, productIds[0] || 0)); // Fallback to prevent empty array issues

      // Group images by product
      const imageMap = new Map();
      images.forEach(img => {
        if (!imageMap.has(img.productId)) {
          imageMap.set(img.productId, []);
        }
        imageMap.get(img.productId).push(img.url);
      });

      const formatted = searchResults.map(product => ({
        ...product,
        category: product.categoryName || 'Uncategorized',
        images: imageMap.get(product.id) || [],
        provider: 'Unknown Provider'
      }));

      return c.json(formatted);
    }

    if (category) {
      // Category-based search
      const result = await db.query.products.findMany({
        where: and(
          eq(products.status, 'published')
        ),
        orderBy: [desc(products.createdAt)],
        with: {
          images: {
            columns: {
              url: true
            }
          },
          category: {
            columns: {
              name: true,
              description: true
            }
          },
          provider: {
            columns: {
              id: true,
              firstName: true,
              lastName: true
            }
          }
        }
      });

      // Filter by category name
      const filtered = result.filter(product => 
        product.category?.name?.toLowerCase().includes(category.toLowerCase())
      );

      const formatted = filtered.map((product) => ({
        ...product,
        category: product.category?.name || 'Uncategorized',
        images: product.images.map(img => img.url),
        provider: product.provider 
          ? `${product.provider.firstName} ${product.provider.lastName}`
          : 'Unknown Provider'
      }));

      return c.json(formatted);
    }

    // No search parameters, return all
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
            name: true,
            description: true
          }
        },
        provider: {
          columns: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    const formatted = result.map((product) => ({
      ...product,
      category: product.category?.name || 'Uncategorized',
      images: product.images.map(img => img.url),
      provider: product.provider 
        ? `${product.provider.firstName} ${product.provider.lastName}`
        : 'Unknown Provider'
    }));

    return c.json(formatted);
  } catch (error) {
    console.error('Error searching products:', error);
    return c.json({ error: 'Failed to search products' }, 500);
  }
});

export default publicProduct;