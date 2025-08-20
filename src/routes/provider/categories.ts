// src/routes/admin/categories.ts
import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { categories, products } from '../../drizzle/schema.js';
import { adminRoleAuth } from '../../middleware/bearAuth.js';

const adminCategories = new Hono()
  .use('*', adminRoleAuth);

// Get all categories
adminCategories.get('/', async (c) => {
  try {
    const result = await db.query.categories.findMany({
      orderBy: [desc(categories.createdAt)],
    });
    return c.json(result);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return c.json({ error: 'Failed to fetch categories' }, 500);
  }
});

// Create category
adminCategories.post('/', async (c) => {
  const { name, description } = await c.req.json();

  if (!name) {
    return c.json({ error: 'Category name is required' }, 400);
  }

  try {
    const [category] = await db.insert(categories).values({
      name,
      description,
    }).returning();

    return c.json(category, 201);
  } catch (error) {
    console.error('Error creating category:', error);
    return c.json({ error: 'Failed to create category' }, 500);
  }
});

// Update category
adminCategories.patch('/:id', async (c) => {
  const categoryId = parseInt(c.req.param('id'));
  const { name, description, isActive } = await c.req.json();

  try {
    const [category] = await db.update(categories)
      .set({ 
        name,
        description,
        isActive,
        updatedAt: new Date()
      })
      .where(eq(categories.id, categoryId))
      .returning();

    if (!category) {
      return c.json({ error: 'Category not found' }, 404);
    }

    return c.json(category);
  } catch (error) {
    console.error('Error updating category:', error);
    return c.json({ error: 'Failed to update category' }, 500);
  }
});

// Delete category (soft delete by setting isActive to false)
adminCategories.delete('/:id', async (c) => {
  const categoryId = parseInt(c.req.param('id'));

  try {
    // Check if category is used by any products
    const productsUsingCategory = await db.query.products.findMany({
      where: eq(products.categoryId, categoryId),
      limit: 1
    });

    if (productsUsingCategory.length > 0) {
      return c.json({ 
        error: 'Cannot delete category. It is being used by products.',
        productsCount: productsUsingCategory.length
      }, 400);
    }

    await db.delete(categories)
      .where(eq(categories.id, categoryId));

    return c.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    return c.json({ error: 'Failed to delete category' }, 500);
  }
});

export default adminCategories;