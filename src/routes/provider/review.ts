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
const userId = parseInt(user.id); 
    const { providerId, rating, comment } = await c.req.json();

    // Validate input
    if (!providerId || !rating) {
      return c.json({
        success: false,
        error: 'Provider ID and rating are required'
      }, 400);
    }

    if (rating < 1 || rating > 5) {
      return c.json({
        success: false,
        error: 'Rating must be between 1 and 5'
      }, 400);
    }

    // Check if provider exists
    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, providerId)
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
        eq(reviews.providerId, providerId)
      )
    });

    if (existingReview) {
      return c.json({
        success: false,
        error: 'You have already reviewed this provider'
      }, 409);
    }

    // Create the review
    const [newReview] = await db.insert(reviews).values({
      userId,
      providerId,
      rating,
      comment: comment?.trim() || null,
    }).returning();

    // Calculate new average rating for the provider
    const ratingStats = await db
      .select({
        averageRating: sql<number>`ROUND(AVG(${reviews.rating})::numeric, 1)`,
        reviewCount: sql<number>`COUNT(*)::int`,
      })
      .from(reviews)
      .where(eq(reviews.providerId, providerId));

    const { averageRating, reviewCount } = ratingStats[0];

    // Update provider's rating
    await db
      .update(providers)
      .set({ 
        rating: Math.round(averageRating * 10) / 10 // Round to 1 decimal
      })
      .where(eq(providers.id, providerId));

    return c.json({
      success: true,
      data: newReview,
      averageRating,
      reviewCount
    }, 201);

  } catch (error) {
    console.error('Error creating review:', error);
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

    // Get rating stats
    const ratingStats = await db
      .select({
        averageRating: sql<number>`ROUND(AVG(${reviews.rating})::numeric, 1)`,
        reviewCount: sql<number>`COUNT(*)::int`,
      })
      .from(reviews)
      .where(eq(reviews.providerId, providerId));

    return c.json({
      success: true,
      data: {
        reviews: providerReviews,
        stats: ratingStats[0]
      }
    });

  } catch (error) {
    console.error('Error fetching reviews:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch reviews',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default reviewRoutes;