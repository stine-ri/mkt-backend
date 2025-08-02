// services/interests.ts
import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { interests, requests, providers } from '../../drizzle/schema.js';
import { eq, and } from 'drizzle-orm';
import type { CustomContext } from '../../types/context.js';

const app = new Hono<CustomContext>();

// Express interest
app.post('/:requestId', async (c) => {
  try {
    const requestId = Number(c.req.param('requestId'));
    const user = c.get('user');

    // 1. Verify provider exists first
    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, Number(user.id))
    });

    // Consider adding more context to the 404 responses
    if (!provider) {
      return c.json({ 
        error: "Provider profile not found",
        solution: "Please complete your provider profile first"
      }, 404);
    }

    // 2. Then proceed with existing checks
    const request = await db.query.requests.findFirst({
      where: and(
        eq(requests.id, requestId),
        eq(requests.allowInterests, true)
      )
    });

    if (!request) {
      return c.json({ 
        error: "Request not available",
        solution: "This request may have been closed or does not accept interests"
      }, 404);
    }

    const existingInterest = await db.query.interests.findFirst({
      where: and(
        eq(interests.requestId, requestId),
        eq(interests.providerId, provider.id) // Use provider.id not user.id
      )
    });

    // Add more detailed conflict message
    if (existingInterest) {
      return c.json({ 
        error: "Interest already exists",
        existingInterestId: existingInterest.id // Helps with debugging
      }, 409);
    }

    // 3. Create interest with validated provider.id
    const [newInterest] = await db.insert(interests).values({
      requestId,
      providerId: provider.id,
      createdAt: new Date()
    }).returning();

    return c.json(newInterest, 201);

  } catch (error) {
    // Add timestamp to error logs for debugging
    console.error(`[${new Date().toISOString()}] Error:`, error);
    return c.json({ 
      error: "Internal server error",
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get interests for a request
app.get('/request/:requestId', async (c) => {
  const requestId = c.req.param('requestId');
const result = await db.query.interests.findMany({
  where: eq(interests.requestId, Number(requestId)),
  with: {
    provider: true
  }
});
return c.json(result);

});
// Get interests for the logged-in provider
app.get('/my', async (c) => {
  try {
    const user = c.get('user');
    const userId = Number(user.id);

    // Find provider profile
    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, userId)
    });

    if (!provider) {
      return c.json({ error: 'Provider profile not found' }, 404);
    }

    // Fetch interests with request data
    const result = await db.query.interests.findMany({
      where: eq(interests.providerId, provider.id),
      with: {
        request: {
          with: {
            service: true, // Include service details if needed
            user: true    // Include user details if needed
          }
        },
      }
    });

    return c.json(result);
    
  } catch (error) {
  console.error('Error fetching interests:', error);

  if (error instanceof Error) {
    return c.json({ 
      error: 'Failed to fetch interests',
      details: error.message 
    }, 500);
  }

  return c.json({
    error: 'Failed to fetch interests',
    details: 'An unknown error occurred'
  }, 500);
}
});

// Delete an interest
app.delete('/:interestId', async (c) => {
  try {
    const interestId = Number(c.req.param('interestId'));
    const user = c.get('user');

    // Get the provider
    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, Number(user.id))
    });

    if (!provider) {
      return c.json({ error: 'Provider profile not found' }, 404);
    }

    // Check if the interest belongs to the provider
    const interest = await db.query.interests.findFirst({
      where: and(
        eq(interests.id, interestId),
        eq(interests.providerId, provider.id)
      )
    });

    if (!interest) {
      return c.json({ error: 'Interest not found or unauthorized' }, 404);
    }

    // Delete the interest
    await db.delete(interests).where(eq(interests.id, interestId));

    return c.json({ message: 'Interest deleted successfully' });

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Delete Interest Error:`, error);
    return c.json({
      error: 'Failed to delete interest',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});



export default app;
