import { Hono } from 'hono';
import { eq, desc, ilike, or, and } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { products, productImages, providers} from '../../drizzle/schema.js';

const publicProduct = new Hono();

// Public endpoint to get all published products
publicProduct.get('/', async (c) => {
  try {
    // Use the same pattern as your search endpoint to include images
    const result = await db.select()
      .from(products)
      .leftJoin(productImages, eq(products.id, productImages.productId))
      .where(eq(products.status, 'published'))
      .orderBy(desc(products.createdAt));

    // Group images by product (same logic as search endpoint)
    const productsMap = new Map();
    result.forEach(row => {
      const product = row.products;
      if (!productsMap.has(product.id)) {
        productsMap.set(product.id, {
          ...product,
          images: []
        });
      }
      if (row.product_images?.url) {
        productsMap.get(product.id).images.push(row.product_images.url);
      }
    });

    const formatted = Array.from(productsMap.values()).map((product) => ({
      ...product,
      provider: 'Unknown Provider' // Keep this default since provider relation doesn't exist
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
    
    // Build the base query
    const baseQuery = db.select()
      .from(products)
      .leftJoin(productImages, eq(products.id, productImages.productId))
      .orderBy(desc(products.createdAt));

    // Build conditions array
    const conditions = [eq(products.status, 'published')];

    if (search) {
      const searchCondition = or(
        ilike(products.name, `%${search}%`),
        ilike(products.description, `%${search}%`),
        ilike(products.category, `%${search}%`)
      );
      
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    if (category) {
      conditions.push(ilike(products.category, `%${category}%`));
    }

    // Execute query with all conditions
    const result = await baseQuery.where(and(...conditions));

    // Group images by product
    const productsMap = new Map();
    result.forEach(row => {
      const product = row.products;
      if (!productsMap.has(product.id)) {
        productsMap.set(product.id, {
          ...product,
          images: []
        });
      }
      if (row.product_images?.url) {
        productsMap.get(product.id).images.push(row.product_images.url);
      }
    });

    const formatted = Array.from(productsMap.values()).map((product) => ({
      ...product,
      provider: 'Unknown Provider'
    }));

    return c.json(formatted);
  } catch (error) {
    console.error('Error searching products:', error);
    return c.json({ error: 'Failed to search products' }, 500);
  }
});

export default publicProduct;