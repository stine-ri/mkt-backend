// src/routes/admin/products.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware, adminRoleAuth } from '../../middleware/bearAuth.js';
import { db } from '../../drizzle/db.js';
import { products, providers, users, productImages, productSales, categories } from '../../drizzle/schema.js';
import { and, eq, sql, gte, count, avg, inArray, desc } from 'drizzle-orm';
import type {
  TIProducts,
  TSProducts,
  TIProviders,
  TSProviders,
  TSUsers,
  TIProductImages,
  TSProductImages,
  TIProductSales,
  TSProductSales
} from '../../drizzle/schema.js';

import { z } from 'zod';

const router = new Hono();

// Apply authentication and admin role middleware to all routes
router.use('*', authMiddleware);
router.use('*', adminRoleAuth);

// Product schema for validation - Updated to use categoryId
const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  price: z.number().positive().transform(val => val.toString()), // Convert to string for numeric field
  categoryId: z.number().int().positive().optional(), // Changed from category to categoryId
  stock: z.number().int().min(0).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional().default('draft'),
  providerId: z.number().int().positive(),
});

// GET /api/admin/products - Get all products with provider and user info
router.get('/', async (c) => {
  try {
    // Get pagination parameters from query
    const { page = '1', limit = '10' } = c.req.query();
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // First get the total count
    const totalCount = await db
      .select({ count: count() })
      .from(products);

    // Then get the paginated results with category name
    const productsWithDetails = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        categoryId: products.categoryId,
        categoryName: categories.name, // Get actual category name
        stock: products.stock,
        status: products.status,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        provider: {
          id: providers.id,
          firstName: providers.firstName,
          lastName: providers.lastName,
          phoneNumber: providers.phoneNumber,
          userId: providers.userId,
        },
        user: {
          id: users.id,
          full_name: users.full_name,
          email: users.email,
          contact_phone: users.contact_phone,
        },
        images: sql<Array<{
          id: number;
          url: string;
          isPrimary: boolean;
        }>>`
          (SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', pi.id,
                'url', pi.url,
                'isPrimary', pi.is_primary
              )
            ),
            '[]'::json
          )
          FROM ${productImages} pi
          WHERE pi.product_id = ${products.id})
        `,
      })
      .from(products)
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(users, eq(providers.userId, users.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .orderBy(desc(products.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Transform the response to include category as string
    const transformedData = productsWithDetails.map(item => ({
      ...item,
      category: item.categoryName || 'Uncategorized'
    }));

    return c.json({
      data: transformedData,
      pagination: {
        total: totalCount[0].count,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount[0].count / limitNum),
      },
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    throw new HTTPException(500, {
      message: 'Failed to fetch products',
      cause: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/admin/products/:id - Get specific product with details
router.get('/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      throw new HTTPException(400, { message: 'Invalid product ID' });
    }

    const productWithDetails = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        categoryId: products.categoryId,
        categoryName: categories.name,
        stock: products.stock,
        status: products.status,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        provider: {
          id: providers.id,
          firstName: providers.firstName,
          lastName: providers.lastName,
          phoneNumber: providers.phoneNumber,
          userId: providers.userId,
        },
        user: {
          id: users.id,
          full_name: users.full_name,
          email: users.email,
          contact_phone: users.contact_phone,
        },
        images: sql<
          Array<{
            id: number;
            url: string;
            isPrimary: boolean;
          }>
        >`COALESCE(
          (SELECT json_agg(json_build_object(
            'id', pi.id,
            'url', pi.url,
            'isPrimary', pi.is_primary
          )) 
          FROM ${productImages} pi 
          WHERE pi.product_id = ${products.id}
        ), '[]'::json)`,
        salesCount: sql<number>`(
          SELECT COUNT(*) 
          FROM ${productSales} ps 
          WHERE ps.product_id = ${products.id}
        )`,
      })
      .from(products)
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(users, eq(providers.userId, users.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.id, id));

    if (!productWithDetails.length) {
      throw new HTTPException(404, { message: 'Product not found' });
    }

    // Transform the response
    const result = {
      ...productWithDetails[0],
      category: productWithDetails[0].categoryName || 'Uncategorized'
    };

    return c.json(result);
  } catch (error) {
    console.error('Error fetching product:', error);
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: 'Failed to fetch product',
      cause: error,
    });
  }
});

// POST /api/admin/products - Create new product
router.post('/', async (c) => {
  try {
    const rawData = await c.req.json();
    const parsedData = productSchema.parse({
      ...rawData,
      price: parseFloat(rawData.price),
      providerId: parseInt(rawData.providerId),
      categoryId: rawData.categoryId ? parseInt(rawData.categoryId) : undefined,
      stock: rawData.stock ? parseInt(rawData.stock) : undefined,
    });

    // Convert to database insert type
    const insertData: TIProducts = {
      ...parsedData,
      providerId: parsedData.providerId,
      status: parsedData.status,
    };

    // Validate provider exists
    const provider = await db
      .select()
      .from(providers)
      .where(eq(providers.id, insertData.providerId))
      .limit(1);

    if (!provider.length) {
      throw new HTTPException(400, { message: 'Provider not found' });
    }

    // Validate category exists if provided
    if (insertData.categoryId) {
      const category = await db
        .select()
        .from(categories)
        .where(eq(categories.id, insertData.categoryId))
        .limit(1);

      if (!category.length) {
        throw new HTTPException(400, { message: 'Category not found' });
      }
    }

    // Create product
    const [newProduct] = await db
      .insert(products)
      .values(insertData)
      .returning();

    // Fetch the created product with details
    const createdProduct = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        categoryId: products.categoryId,
        categoryName: categories.name,
        stock: products.stock,
        status: products.status,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        provider: {
          id: providers.id,
          firstName: providers.firstName,
          lastName: providers.lastName,
          phoneNumber: providers.phoneNumber,
          userId: providers.userId,
        },
        user: {
          id: users.id,
          full_name: users.full_name,
          email: users.email,
          contact_phone: users.contact_phone,
        },
      })
      .from(products)
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(users, eq(providers.userId, users.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.id, newProduct.id));

    const result = {
      ...createdProduct[0],
      category: createdProduct[0].categoryName || 'Uncategorized'
    };

    return c.json(result, 201);
  } catch (error) {
    console.error('Error creating product:', error);
    if (error instanceof z.ZodError) {
      throw new HTTPException(400, {
        message: 'Validation error',
        res: new Response(JSON.stringify({ errors: error.errors }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      });
    }
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: 'Failed to create product',
    });
  }
});

// PUT /api/admin/products/:id - Update product
router.put('/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      throw new HTTPException(400, { message: 'Invalid product ID' });
    }

    const rawData = await c.req.json();
    const parsedData = productSchema.partial().parse({
      ...rawData,
      price: rawData.price !== undefined ? parseFloat(rawData.price) : undefined,
      providerId: rawData.providerId !== undefined ? parseInt(rawData.providerId) : undefined,
      categoryId: rawData.categoryId !== undefined ? parseInt(rawData.categoryId) : undefined,
      stock: rawData.stock !== undefined ? parseInt(rawData.stock) : undefined,
    });

    // Convert to database update type
    const updateData: Partial<TIProducts> = {
      ...parsedData,
    };

    // Find product
    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!product.length) {
      throw new HTTPException(404, { message: 'Product not found' });
    }

    // Validate provider if providerId is being updated
    if (updateData.providerId && updateData.providerId !== product[0].providerId) {
      const provider = await db
        .select()
        .from(providers)
        .where(eq(providers.id, updateData.providerId))
        .limit(1);

      if (!provider.length) {
        throw new HTTPException(400, { message: 'Provider not found' });
      }
    }

    // Validate category if categoryId is being updated
    if (updateData.categoryId && updateData.categoryId !== product[0].categoryId) {
      const category = await db
        .select()
        .from(categories)
        .where(eq(categories.id, updateData.categoryId))
        .limit(1);

      if (!category.length) {
        throw new HTTPException(400, { message: 'Category not found' });
      }
    }

    // Update product
    const [updatedProduct] = await db
      .update(products)
      .set(updateData)
      .where(eq(products.id, id))
      .returning();

    // Fetch updated product with details
    const updatedProductWithDetails = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        categoryId: products.categoryId,
        categoryName: categories.name,
        stock: products.stock,
        status: products.status,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        provider: {
          id: providers.id,
          firstName: providers.firstName,
          lastName: providers.lastName,
          phoneNumber: providers.phoneNumber,
          userId: providers.userId,
        },
        user: {
          id: users.id,
          full_name: users.full_name,
          email: users.email,
          contact_phone: users.contact_phone,
        },
      })
      .from(products)
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(users, eq(providers.userId, users.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.id, id));

    const result = {
      ...updatedProductWithDetails[0],
      category: updatedProductWithDetails[0].categoryName || 'Uncategorized'
    };

    return c.json(result);
  } catch (error) {
    console.error('Error updating product:', error);
    if (error instanceof z.ZodError) {
      throw new HTTPException(400, {
        message: 'Validation error',
        res: new Response(JSON.stringify({ errors: error.errors }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      });
    }
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: 'Failed to update product',
    });
  }
});

// DELETE /api/admin/products/:id - Delete product
router.delete('/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      throw new HTTPException(400, { message: 'Invalid product ID' });
    }

    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!product.length) {
      throw new HTTPException(404, { message: 'Product not found' });
    }

    await db.delete(products).where(eq(products.id, id));

    return c.json({
      message: 'Product deleted successfully',
      deletedProduct: {
        id: product[0].id,
        name: product[0].name,
      },
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: 'Failed to delete product',
    });
  }
});

// POST /api/admin/products/bulk-delete - Bulk delete products
router.post('/bulk-delete', async (c) => {
  try {
    const { ids } = await c.req.json();

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new HTTPException(400, { message: 'Product IDs array is required' });
    }

    // Validate all IDs are numbers
    const validIds = ids.map(id => Number(id)).filter(id => !isNaN(id));
    if (validIds.length !== ids.length) {
      throw new HTTPException(400, { message: 'All IDs must be valid numbers' });
    }

    // Find existing products
    const productsToDelete = await db
      .select({
        id: products.id,
        name: products.name,
      })
      .from(products)
      .where(inArray(products.id, validIds));

    if (productsToDelete.length === 0) {
      throw new HTTPException(404, { message: 'No products found with provided IDs' });
    }

    // Delete products
    await db
      .delete(products)
      .where(inArray(products.id, validIds));

    return c.json({
      message: `Successfully deleted ${productsToDelete.length} products`,
      deletedCount: productsToDelete.length,
      deletedProducts: productsToDelete.map((p: Pick<TSProducts, 'id' | 'name'>) => ({ 
        id: p.id, 
        name: p.name 
      })),
    });
  } catch (error) {
    console.error('Error bulk deleting products:', error);
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: 'Failed to delete products',
    });
  }
});

// GET /api/admin/products/stats/overview - Get product statistics
router.get('/stats/overview', async (c) => {
  try {
    // Define correct types for the statistics
    type StatusCount = { status: string; count: number };
    type CategoryCount = { categoryId: number | null; categoryName: string | null; count: number };
    type CategoryAvgPrice = { categoryId: number | null; categoryName: string | null; avgPrice: string | null };

    // Total products
    const totalProducts = await db.select({ count: count() }).from(products);

    // Products by status
    const productsByStatus = await db
      .select({
        status: products.status,
        count: count(),
      })
      .from(products)
      .groupBy(products.status);

    // Products by category with category names
    const productsByCategory = await db
      .select({
        categoryId: products.categoryId,
        categoryName: categories.name,
        count: count(),
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .groupBy(products.categoryId, categories.name)
      .orderBy(count());

    // Average price by category with category names
    const avgPriceByCategory = await db
      .select({
        categoryId: products.categoryId,
        categoryName: categories.name,
        avgPrice: avg(products.price),
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .groupBy(products.categoryId, categories.name)
      .orderBy(products.categoryId);

    // Recent products (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentProducts = await db
      .select({ count: count() })
      .from(products)
      .where(gte(products.createdAt, thirtyDaysAgo));

    // Total sales
    const totalSales = await db.select({ count: count() }).from(productSales);

    return c.json({
      totalProducts: totalProducts[0].count,
      productsByStatus: productsByStatus.map((item: StatusCount) => ({
        status: item.status,
        count: item.count,
      })),
      recentProducts: recentProducts[0].count,
      productsByCategory: productsByCategory.map((item: CategoryCount) => ({
        categoryId: item.categoryId,
        category: item.categoryName || 'Uncategorized',
        count: item.count,
      })),
      avgPriceByCategory: avgPriceByCategory.map((item: CategoryAvgPrice) => ({
        categoryId: item.categoryId,
        category: item.categoryName || 'Uncategorized',
        avgPrice: item.avgPrice ? parseFloat(item.avgPrice).toFixed(2) : '0.00',
      })),
      totalSales: totalSales[0].count,
    });
  } catch (error) {
    console.error('Error fetching product stats:', error);
    throw new HTTPException(500, {
      message: 'Failed to fetch product statistics',
    });
  }
});

export default router;