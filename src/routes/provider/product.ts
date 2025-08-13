// src/routes/products.ts
import { Hono } from 'hono';
import { eq, and, desc,ilike,or } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { 
  products, 
  productImages, 
  productSales,
  users
} from '../../drizzle/schema.js';
import { authMiddleware, serviceProviderRoleAuth } from '../../middleware/bearAuth.js';

import { 
  FileUploadError,
  DatabaseError,
  ValidationError 
} from '../../utils/error.js'; 
import { uploadToCloudinary, deleteFromCloudinary } from '../../utils/cloudinary';

const product = new Hono()
  .use('*', authMiddleware)
  .use('*', serviceProviderRoleAuth);





// Get provider's products
product.get('/my',  async (c) => {
  console.log('🔥 /api/product/my route hit');
  
  const user = c.get('user');
  
  // First check if user is authenticated as service provider
  if (user.role !== 'service_provider') {
    return c.json({ error: 'Unauthorized - not a service provider' }, 403);
  }

  // Then check if providerId exists
  if (user.providerId === null || user.providerId === undefined) {
    return c.json({ 
      error: 'Service provider account not properly linked',
      details: 'No provider ID found for this user'
    }, 400);
  }

  try {
    const result = await db.query.products.findMany({
      where: eq(products.providerId, user.providerId),
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
product.post('/', async (c) => {
  const providerId = c.get('user').providerId;
  if (typeof providerId !== 'number') {
    throw new ValidationError('Invalid provider ID');
  }

  const formData = await c.req.formData();

  // Validate required fields
  const name = formData.get('name')?.toString().trim();
  const description = formData.get('description')?.toString().trim();
  const price = formData.get('price')?.toString();
  const category = formData.get('category')?.toString().trim();
  const stock = formData.get('stock')?.toString().trim();
  const imageFiles = formData.getAll('images') as File[];

  if (!name || !description || !price || !category) {
    throw new ValidationError(JSON.stringify({
      error: 'Missing required fields',
      details: {
        name: !name ? 'Product name is required' : undefined,
        description: !description ? 'Description is required' : undefined,
        price: !price ? 'Price is required' : undefined,
        category: !category ? 'Category is required' : undefined
      }
    }));
  }

  // Validate price is a valid number
  const priceNum = parseFloat(price);
  if (isNaN(priceNum)) {
    throw new ValidationError('Price must be a valid number');
  }

  if (imageFiles.length === 0) {
    throw new ValidationError('At least one image is required');
  }

  let productId: number | null = null;
  let uploadedImageUrls: string[] = [];

   try {
    // Step 1: Create the product record (same as before)
    const [product] = await db.insert(products).values({
      providerId,
      name,
      description,
      price: priceNum.toString(),
      category,
      stock: stock ? parseInt(stock) : null,
      status: 'draft',
    }).returning();

    productId = product.id;

    // Step 2: Upload all images to Cloudinary
    const uploadResults = await Promise.allSettled(
      imageFiles.map(async (file) => {
        try {
          const folderPath = `providers/${providerId}/products/${productId}`;
          const { url, public_id } = await uploadToCloudinary(file, folderPath, c);
          return { url, public_id };
        } catch (error) {
          console.error('Error uploading image:', error);
          throw new FileUploadError(`Failed to upload image: ${file.name}`);
        }
      })
    );

    // Check for failed uploads
    const failedUploads = uploadResults.filter(r => r.status === 'rejected');
    if (failedUploads.length > 0) {
      throw new FileUploadError(
        `${failedUploads.length} image upload(s) failed. ` +
        failedUploads.map((f: any) => f.reason?.message).join(', ')
      );
    }

    // Get successful uploads
    const successfulUploads = uploadResults
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<{ url: string, public_id: string }>).value);

    // Step 3: Create all image records in a single batch
    const imageRecords = await db.insert(productImages).values(
      successfulUploads.map(({ url, public_id }) => ({
        productId: productId!,
        url,
        publicId: public_id // Store public_id for future deletion
      }))
    ).returning();

    return c.json({
      ...product,
      images: imageRecords.map(img => img.url),
    }, 201);

  } catch (error) {
    console.error('Error creating product:', error);
    
    // Cleanup if something failed after product creation
    if (productId) {
      try {
        // Delete the product if it was created
        await db.delete(products).where(eq(products.id, productId));
        
        // Delete any uploaded files from Cloudinary
        const imagesToDelete = await db.query.productImages.findMany({
          where: eq(productImages.productId, productId),
          columns: { publicId: true }
        });
        
        await Promise.allSettled(
          imagesToDelete.map(img => 
            img.publicId ? deleteFromCloudinary(img.publicId, c).catch((e: Error) => {
              console.error('Failed to delete file from Cloudinary:', e.message);
            }) : Promise.resolve()
          )
        );
      } catch (cleanupError) {
        console.error('Product deletion failed:', cleanupError instanceof Error 
          ? cleanupError.message 
          : 'Unknown error');
      }
    }
    
    // Error response handling
    if (error instanceof ValidationError) {
      try {
        const details = JSON.parse(error.message);
        return c.json(details, 400);
      } catch {
        return c.json({ error: error.message }, 400);
      }
    }
    
    if (error instanceof FileUploadError) {
      return c.json({ 
        error: 'File upload failed',
        details: error.message 
      }, 400);
    }
    
    return c.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : undefined
    }, 500);
  }
});

// Update product status
product.patch('/:id/status', async (c) => {
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
product.delete('/:id', async (c) => {
  const providerId = c.get('user').providerId;
  if (typeof providerId !== 'number') {
    return c.json({ error: 'Invalid provider ID' }, 400);
  }
  
  const productId = parseInt(c.req.param('id'));

  try {
    await db.transaction(async (tx) => {
      // 1. Get all images to delete from Cloudinary
      const images = await tx.query.productImages.findMany({
        where: eq(productImages.productId, productId),
        columns: { publicId: true }
      });

      // 2. Delete from database first
      await tx.delete(productImages)
        .where(eq(productImages.productId, productId));
      
      await tx.delete(products)
        .where(and(
          eq(products.id, productId),
          eq(products.providerId, providerId)
        ));

      // 3. Delete from Cloudinary after successful DB deletion
      await Promise.allSettled(
        images.map(img => 
          img.publicId ? deleteFromCloudinary(img.publicId, c).catch((e: Error) => {
            console.error('Failed to delete file from Cloudinary:', e.message);
          }) : Promise.resolve()
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
product.get('/sales', async (c) => {
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
product.patch('/sales/:id', async (c) => {
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


export default product;