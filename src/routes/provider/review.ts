import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { reviews, providers } from '../../drizzle/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import type { CustomContext } from '../../types/context.js';
import { authMiddleware } from '../../middleware/bearAuth.js';

const reviewRoutes = new Hono<CustomContext>();

// POST /api/reviews - Create a new review
reviewRoutes.post('/', authMiddleware, async (c: Context<CustomContext>) => {
  try {
    const user = c.get('user');
    
    // Validate user exists
    if (!user || !user.id) {
      return c.json({
        success: false,
        error: 'User not authenticated'
      }, 401);
    }

    const userId = parseInt(user.id);
    
    // Validate userId is a valid number
    if (isNaN(userId)) {
      return c.json({
        success: false,
        error: 'Invalid user ID'
      }, 400);
    }

    const { providerId, rating, comment } = await c.req.json();

    // Validate input
    if (!providerId || !rating) {
      return c.json({
        success: false,
        error: 'Provider ID and rating are required'
      }, 400);
    }

    // Validate providerId is a number
    const providerIdNum = parseInt(providerId);
    if (isNaN(providerIdNum)) {
      return c.json({
        success: false,
        error: 'Invalid provider ID'
      }, 400);
    }

    // Validate rating is a number
    const ratingNum = parseFloat(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return c.json({
        success: false,
        error: 'Rating must be a number between 1 and 5'
      }, 400);
    }

    // Check if provider exists
    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, providerIdNum)
    });

    if (!provider) {
      return c.json({
        success: false,
        error: 'Provider not found'
      }, 404);
    }

    // Check if user is trying to review themselves
    if (provider.userId === userId) {
      return c.json({
        success: false,
        error: 'You cannot review your own profile'
      }, 403);
    }

    // Check if user has already reviewed this provider
    const existingReview = await db.query.reviews.findFirst({
      where: and(
        eq(reviews.userId, userId),
        eq(reviews.providerId, providerIdNum)
      )
    });

    if (existingReview) {
      return c.json({
        success: false,
        error: 'You have already reviewed this provider'
      }, 409);
    }

    // Create the review - rating must be integer for the schema
    const [newReview] = await db.insert(reviews).values({
      userId,
      providerId: providerIdNum,
      rating: Math.round(ratingNum), // Convert to integer
      comment: comment?.trim() || null,
    }).returning();

    // Calculate new average rating for the provider
    const ratingStats = await db
      .select({
        averageRating: sql<number>`COALESCE(ROUND(AVG(${reviews.rating})::numeric, 1), 0)`,
        reviewCount: sql<number>`COUNT(*)::int`,
      })
      .from(reviews)
      .where(eq(reviews.providerId, providerIdNum));

    const stats = ratingStats[0];
    const averageRating = stats?.averageRating || 0;
    const reviewCount = stats?.reviewCount || 0;

    // Update provider's rating - must be integer to match schema
    await db
      .update(providers)
      .set({ 
        rating: Math.round(averageRating) // Store as integer
      })
      .where(eq(providers.id, providerIdNum));

    return c.json({
      success: true,
      data: newReview,
      averageRating,
      reviewCount
    }, 201);

  } catch (error) {
    console.error('Error creating review:', error);
    
    // Log more details for debugging
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }
    
    return c.json({
      success: false,
      error: 'Failed to create review',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// GET /api/reviews/provider/:providerId - Get all reviews for a provider
reviewRoutes.get('/provider/:providerId', async (c: Context<CustomContext>) => {
  try {
    const providerId = parseInt(c.req.param('providerId'));

    if (isNaN(providerId)) {
      return c.json({
        success: false,
        error: 'Invalid provider ID'
      }, 400);
    }

    const providerReviews = await db.query.reviews.findMany({
      where: eq(reviews.providerId, providerId),
      with: {
        user: {
          columns: {
            id: true,
            full_name: true,
            avatar: true,
          }
        }
      },
      orderBy: (reviews, { desc }) => [desc(reviews.createdAt)]
    });

    // Get rating stats - handle case when there are no reviews
    const ratingStats = await db
      .select({
        averageRating: sql<number>`COALESCE(ROUND(AVG(${reviews.rating})::numeric, 1), 0)`,
        reviewCount: sql<number>`COUNT(*)::int`,
      })
      .from(reviews)
      .where(eq(reviews.providerId, providerId));

    return c.json({
      success: true,
      data: {
        reviews: providerReviews,
        stats: ratingStats[0] || { averageRating: 0, reviewCount: 0 }
      }
    });

  } catch (error) {
    console.error('Error fetching reviews:', error);
    
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }
    
    return c.json({
      success: false,
      error: 'Failed to fetch reviews',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default reviewRoutes;