// src/routes/public/categories.ts
import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { categories, products } from '../../drizzle/schema.js';

const publicCategories = new Hono();

// Get all active categories - public endpoint
publicCategories.get('/', async (c) => {
  try {
    const result = await db.query.categories.findMany({
      where: eq(categories.isActive, true),
      orderBy: [desc(categories.createdAt)],
      columns: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true
      }
    });
    
    // Add count of products for each category
    const categoriesWithCount = await Promise.all(
      result.map(async (category) => {
        const productsCount = await db.query.products.findMany({
          where: eq(products.categoryId, category.id)
        });
        
        return {
          ...category,
          count: productsCount.length
        };
      })
    );
    
    return c.json(categoriesWithCount);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return c.json({ error: 'Failed to fetch categories' }, 500);
  }
});

// Get single category by ID - public endpoint
publicCategories.get('/:id', async (c) => {
  const categoryId = parseInt(c.req.param('id'));
  
  try {
    const category = await db.query.categories.findFirst({
      where: eq(categories.id, categoryId),
      columns: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true
      }
    });
    
    if (!category) {
      return c.json({ error: 'Category not found' }, 404);
    }
    
    // Get products count for this category
    const productsCount = await db.query.products.findMany({
      where: eq(products.categoryId, categoryId)
    });
    
    return c.json({
      ...category,
      count: productsCount.length
    });
  } catch (error) {
    console.error('Error fetching category:', error);
    return c.json({ error: 'Failed to fetch category' }, 500);
  }
});

export default publicCategories;