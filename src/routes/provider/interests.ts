// services/interests.ts
import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { interests, requests, providers } from '../../drizzle/schema.js';
import { eq, and } from 'drizzle-orm';
import type { CustomContext } from '../../types/context.js';

const app = new Hono<CustomContext>();

// Express interest
app.post('/:requestId', async (c) => {
  const requestIdParam = c.req.param('requestId');
  const requestId = Number(requestIdParam);
  const user = c.get('user');
  const providerId = Number(user.id);

  // Verify request exists and accepts interests
  const request = await db.query.requests.findFirst({
    where: and(
      eq(requests.id, Number(requestId)),
      eq(requests.allowInterests, true)
    )
  });

  if (!request) return c.json({ error: "Request not found or doesn't accept interests" }, 404);

  // Check for existing interest
  
  const exists = await db.query.interests.findFirst({
    where: and(
      eq(interests.requestId, Number(requestId)),
      eq(interests.providerId, providerId)
    )
  });

  if (exists) return c.json({ error: "Already expressed interest" }, 400);

  // Create interest
  const [interest] = await db.insert(interests).values({
    requestId: Number(requestId),
    providerId: providerId
  }).returning();

  return c.json(interest);
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

export default app;
