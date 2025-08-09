import { Hono } from 'hono';
import { eq, desc, ilike, or, and } from 'drizzle-orm';
import { db } from '../../drizzle/db';
import { products, productImages } from '../../drizzle/schema';

const publicProduct = new Hono();

// Public endpoint to get all published products
publicProduct.get('/', async (c) => {
  try {
    // Simple query based on your actual products schema
    const result = await db.query.products.findMany({
      where: eq(products.status, 'published'), // Only show published products
      orderBy: [desc(products.createdAt)],
      // Remove the 'with' clause since those relations don't exist in your schema
    });

    // Since we don't have images and provider relations, format the data as is
    const formatted = result.map((product) => ({
      ...product,
      images: [], // Empty array since images relation doesn't exist
      provider: 'Unknown Provider' // Default value since provider relation doesn't exist
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
      
      // Only push if searchCondition is not undefined
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

    return c.json(Array.from(productsMap.values()));
  } catch (error) {
    console.error('Error searching products:', error);
    return c.json({ error: 'Failed to search products' }, 500);
  }
});

export default publicProduct;