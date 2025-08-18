// routes/testimonials.ts
import { Hono } from 'hono';
import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { testimonials, users, requests, providers } from '../../drizzle/schema.js';
import { authMiddleware, clientRoleAuth, adminRoleAuth } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.ts';

const testimonialsRouter = new Hono<CustomContext>();

// Public route - Get approved testimonials for landing page
testimonialsRouter.get('/public', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '6');
    const offset = parseInt(c.req.query('offset') || '0');
    const category = c.req.query('category');
    const minRating = parseInt(c.req.query('minRating') || '1');

    let whereConditions = and(
      eq(testimonials.status, 'approved'),
      eq(testimonials.isPublic, true),
      gte(testimonials.rating, minRating)
    );

    // Add category filter if provided
    if (category) {
      whereConditions = and(
        whereConditions,
        eq(testimonials.serviceCategory, category)
      );
    }

    const result = await db
      .select({
        id: testimonials.id,
        userName: testimonials.userName,
        userRole: testimonials.userRole,
        userAvatarUrl: testimonials.userAvatarUrl,
        rating: testimonials.rating,
        reviewText: testimonials.reviewText,
        serviceCategory: testimonials.serviceCategory,
        serviceName: testimonials.serviceName,
        createdAt: testimonials.createdAt,
      })
      .from(testimonials)
      .where(whereConditions)
      .orderBy(desc(testimonials.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json(result);
  } catch (error) {
    console.error('Error fetching public testimonials:', error);
    return c.json({ error: 'Failed to fetch testimonials' }, 500);
  }
});

// Protected route - Client submits testimonial after service completion
testimonialsRouter.post('/', authMiddleware, clientRoleAuth, async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'User not authenticated' }, 401);
    }

    const body = await c.req.json();
    const { requestId, serviceProviderId, rating, reviewText, serviceCategory, serviceName } = body;

    // Validate required fields
    if (!requestId || !rating || !reviewText) {
      return c.json({ error: 'Request ID, rating, and review text are required' }, 400);
    }

    if (rating < 1 || rating > 5) {
      return c.json({ error: 'Rating must be between 1 and 5' }, 400);
    }

    // Verify the request belongs to the user and is completed
    const request = await db.query.requests.findFirst({
      where: and(
        eq(requests.id, requestId),
        eq(requests.userId, parseInt(user.id.toString())), // Convert user.id to number
        eq(requests.status, 'closed') // Using your schema's status values
      )
    });

    if (!request) {
      return c.json({ error: 'Request not found or not eligible for review' }, 404);
    }

    // Check if user already submitted a testimonial for this request
    const existingTestimonial = await db.query.testimonials.findFirst({
      where: and(
        eq(testimonials.userId, parseInt(user.id.toString())), // Convert user.id to number
        eq(testimonials.requestId, requestId)
      )
    });

    if (existingTestimonial) {
      return c.json({ error: 'You have already submitted a review for this request' }, 400);
    }

    // Get user details for the testimonial
    const userData = await db.query.users.findFirst({
      where: eq(users.id, parseInt(user.id.toString())), // Convert user.id to number
      columns: {
        full_name: true,
        email: true,
        avatar: true,
      }
    });

    // Create testimonial
    const newTestimonial = await db.insert(testimonials).values({
      userId: parseInt(user.id.toString()), // Convert user.id to number
      requestId: parseInt(requestId.toString()), // Ensure it's a number
      providerId: serviceProviderId ? parseInt(serviceProviderId.toString()) : null, // Fixed: Use correct field name and convert to number
      userName: userData?.full_name || 'Anonymous User',
      userEmail: userData?.email || '',
      userRole: 'client',
      userAvatarUrl: userData?.avatar || null,
      rating: parseInt(rating.toString()), // Ensure it's a number
      reviewText,
      serviceCategory: serviceCategory || null,
      serviceName: serviceName || null,
      status: 'pending', // Using enum value
      isPublic: true,
    }).returning();

    return c.json({ 
      message: 'Testimonial submitted successfully. It will be visible after admin approval.',
      testimonial: newTestimonial[0]
    }, 201);
  } catch (error) {
    console.error('Error creating testimonial:', error);
    return c.json({ error: 'Failed to create testimonial' }, 500);
  }
});

// Admin routes - Manage testimonials
testimonialsRouter.get('/admin', authMiddleware, adminRoleAuth, async (c) => {
  try {
    const status = c.req.query('status'); // 'pending', 'approved', 'all'
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = parseInt(c.req.query('offset') || '0');

    let whereCondition;
    if (status === 'pending') {
      whereCondition = eq(testimonials.status, 'pending');
    } else if (status === 'approved') {
      whereCondition = eq(testimonials.status, 'approved');
    }
    // For 'all', no where condition

    const result = await db
      .select()
      .from(testimonials)
      .where(whereCondition)
      .orderBy(desc(testimonials.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json(result);
  } catch (error) {
    console.error('Error fetching testimonials for admin:', error);
    return c.json({ error: 'Failed to fetch testimonials' }, 500);
  }
});

testimonialsRouter.put('/:id/approve', authMiddleware, adminRoleAuth, async (c) => {
  try {
    const user = c.get('user');
    const testimonialId = parseInt(c.req.param('id')); // Fixed: Use c.req.param() for route parameters

    await db
      .update(testimonials)
      .set({
        status: 'approved',
        moderatedBy: parseInt(user?.id?.toString() || '0') || null, // Convert to number safely
        updatedAt: new Date(),
      })
      .where(eq(testimonials.id, testimonialId));

    return c.json({ message: 'Testimonial approved successfully' });
  } catch (error) {
    console.error('Error approving testimonial:', error);
    return c.json({ error: 'Failed to approve testimonial' }, 500);
  }
});

testimonialsRouter.put('/:id/reject', authMiddleware, adminRoleAuth, async (c) => {
  try {
    const user = c.get('user');
    const testimonialId = parseInt(c.req.param('id')); // Fixed: Use c.req.param() for route parameters
    const body = await c.req.json();
    const { notes } = body;

    await db
      .update(testimonials)
      .set({
        status: 'rejected',
        isPublic: false,
        moderatedBy: parseInt(user?.id?.toString() || '0') || null, // Convert to number safely
        moderationNotes: notes || null,
        updatedAt: new Date(),
      })
      .where(eq(testimonials.id, testimonialId));

    return c.json({ message: 'Testimonial rejected successfully' });
  } catch (error) {
    console.error('Error rejecting testimonial:', error);
    return c.json({ error: 'Failed to reject testimonial' }, 500);
  }
});

// Client route - Get user's own testimonials
testimonialsRouter.get('/my-reviews', authMiddleware, clientRoleAuth, async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'User not authenticated' }, 401);
    }

    const userTestimonials = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.userId, parseInt(user.id.toString()))) // Convert user.id to number
      .orderBy(desc(testimonials.createdAt));

    return c.json(userTestimonials);
  } catch (error) {
    console.error('Error fetching user testimonials:', error);
    return c.json({ error: 'Failed to fetch testimonials' }, 500);
  }
});

export default testimonialsRouter;