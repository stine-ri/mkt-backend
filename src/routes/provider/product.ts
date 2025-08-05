// src/routes/products.ts
import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { 
  products, 
  productImages, 
  productSales,
  users
} from '../../drizzle/schema.js';
import { authMiddleware, serviceProviderRoleAuth } from '../../middleware/bearAuth.js';

const app = new Hono()
  .use('*', authMiddleware)
  .use('*', serviceProviderRoleAuth);

// Helper function to handle image URLs (replace with your actual storage solution)
const handleImageUpload = async (file: File): Promise<string> => {
  // In a real implementation, this would upload to your storage service
  // For now, we'll just return a placeholder URL
  return `https://example.com/images/${file.name}`;
};

// Get provider's products
app.get('/my', async (c) => {
  const providerId = c.get('user').providerId;
if (typeof providerId !== 'number') {
  return c.json({ error: 'Invalid provider ID' }, 400);
}
  try {
    const result = await db.query.products.findMany({
      where: eq(products.providerId, providerId),
      orderBy: [desc(products.createdAt)],
      with: {
        images: {
          columns: {
            url: true
          }
        }
      }
    });

    const formatted = result.map(p => ({
      ...p,
      images: p.images.map(i => i.url)
    }));

    return c.json(formatted);
  } catch (error) {
    console.error('Error fetching products:', error);
    return c.json({ error: 'Failed to fetch products' }, 500);
  }
});

// Create new product
app.post('/', async (c) => {
  const providerId = c.get('user').providerId;
  if (typeof providerId !== 'number') {
  return c.json({ error: 'Invalid provider ID' }, 400);
}
  const formData = await c.req.formData();

  const name = formData.get('name') as string;
  const description = formData.get('description') as string;
  const price = formData.get('price') as string;
  const category = formData.get('category') as string;
  const stock = formData.get('stock') as string;
  const imageFiles = formData.getAll('images') as File[];

  if (!name || !description || !price || !category) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  try {
    const product = await db.transaction(async (tx) => {
      // Create product
      const [product] = await tx.insert(products).values({
        providerId,
        name,
        description,
        price,
        category,
        stock: stock ? parseInt(stock) : null,
        status: 'draft',
      }).returning();

      // Handle image uploads
      const uploadedImages = await Promise.all(
        imageFiles.map(async (file) => {
          const url = await handleImageUpload(file);
          return tx.insert(productImages).values({
            productId: product.id,
            url,
          }).returning();
        })
      );

      return {
        ...product,
        images: uploadedImages.flat().map(img => img.url),
      };
    });

    return c.json(product, 201);
  } catch (error) {
    console.error('Error creating product:', error);
    return c.json({ error: 'Failed to create product' }, 500);
  }
});

// Update product status
app.patch('/:id/status', async (c) => {
  const providerId = c.get('user').providerId;
  if (typeof providerId !== 'number') {
  return c.json({ error: 'Invalid provider ID' }, 400);
}
  const productId = parseInt(c.req.param('id'));
  const { status } = await c.req.json();

  if (!['published', 'draft', 'archived'].includes(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  try {
    const [product] = await db.update(products)
      .set({ 
        status,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(products.id, productId),
          eq(products.providerId, providerId)
        )
      )
      .returning();

    if (!product) {
      return c.json({ error: 'Product not found' }, 404);
    }

    return c.json(product);
  } catch (error) {
    console.error('Error updating product:', error);
    return c.json({ error: 'Failed to update product' }, 500);
  }
});

// Delete product
app.delete('/:id', async (c) => {
  const providerId = c.get('user').providerId;
  if (typeof providerId !== 'number') {
  return c.json({ error: 'Invalid provider ID' }, 400);
}
  const productId = parseInt(c.req.param('id'));

  try {
    await db.transaction(async (tx) => {
      // Delete product images first
      await tx.delete(productImages)
        .where(eq(productImages.productId, productId));

      // Then delete product
      await tx.delete(products)
        .where(
          and(
            eq(products.id, productId),
            eq(products.providerId, providerId)
          )
        );
    });

    return c.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    return c.json({ error: 'Failed to delete product' }, 500);
  }
});

// Get product sales
app.get('/sales', async (c) => {
  const providerId = c.get('user').providerId;
if (typeof providerId !== 'number') {
  return c.json({ error: 'Invalid provider ID' }, 400);
}
  try {
    const sales = await db.query.productSales.findMany({
      where: eq(productSales.providerId, providerId),
      orderBy: [desc(productSales.createdAt)],
      with: {
        customer: {
          columns: {
            full_name: true,
            email: true
          }
        },
        product: {
          columns: {
            name: true
          },
          with: {
            images: {
              columns: {
                url: true
              },
              limit: 1
            }
          }
        }
      }
    });

    const formatted = sales.map(sale => ({
      ...sale,
      customer: {
        name: sale.customer?.full_name,
        email: sale.customer?.email
      },
      product: {
        name: sale.product?.name,
        mainImage: sale.product?.images[0]?.url || '/default-product.png'
      }
    }));

    return c.json(formatted);
  } catch (error) {
    console.error('Error fetching sales:', error);
    return c.json({ error: 'Failed to fetch sales' }, 500);
  }
});

// Update sale status
app.patch('/sales/:id', async (c) => {
  const providerId = c.get('user').providerId;
  if (typeof providerId !== 'number') {
  return c.json({ error: 'Invalid provider ID' }, 400);
}
  const saleId = parseInt(c.req.param('id'));
  const { status } = await c.req.json();

  if (!['completed', 'cancelled'].includes(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  try {
    const [sale] = await db.update(productSales)
      .set({ 
        status,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(productSales.id, saleId),
          eq(productSales.providerId, providerId)
        )
      )
      .returning();

    if (!sale) {
      return c.json({ error: 'Sale not found' }, 404);
    }

    return c.json(sale);
  } catch (error) {
    console.error('Error updating sale:', error);
    return c.json({ error: 'Failed to update sale' }, 500);
  }
});

export default app;