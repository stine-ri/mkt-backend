import { db } from '../drizzle/db.js';
import {
  users,
  requests,
  providers,
  bids,
  providerServices,
} from '../drizzle/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import sendNotification from './notification.js';

// Manually extend request type to include optional latitude and longitude
export async function notifyNearbyProviders(
  request: typeof requests.$inferInsert & {
    latitude?: number;
    longitude?: number;
  }
) {
  if (!request.id) return;

  // Base query with required joins
  let baseQuery = db
    .select()
    .from(providers)
    .innerJoin(users, eq(providers.userId, users.id));

  // Apply service filter if needed
  if (request.isService && request.serviceId) {
    baseQuery = baseQuery.innerJoin(
      providerServices,
      and(
        eq(providerServices.providerId, providers.id),
        eq(providerServices.serviceId, request.serviceId)
      )
    );
  }

  // Build conditions array for the where clause
  const conditions = [];

  // Add college filter if needed
  if (request.isService && request.collegeFilterId) {
    conditions.push(eq(providers.collegeId, request.collegeFilterId));
  }

  // Add geolocation filter if coordinates are provided
  if (request.latitude && request.longitude) {
    const earthRadius = 6371; // kilometers

    conditions.push(sql`${earthRadius} * acos(
      cos(radians(${request.latitude})) * 
      cos(radians(CAST(${providers.latitude} AS numeric))) * 
      cos(radians(CAST(${providers.longitude} AS numeric)) - radians(${request.longitude})) + 
      sin(radians(${request.latitude})) * 
      sin(radians(CAST(${providers.latitude} AS numeric)))
    ) <= 50`);
  }

  // Apply all conditions with AND
  const finalQuery = conditions.length > 0 
    ? baseQuery.where(and(...conditions))
    : baseQuery;

  // Execute the query
  const relevantProviders = await finalQuery;

  // Step 6: Notify and optionally auto-bid
  for (const provider of relevantProviders) {
    const providerData = provider.providers;

    await sendNotification(providerData.userId, {
      type: 'new_request',
      message: `New ${request.isService ? 'service' : 'product'} request matching your profile`,
      relatedEntityId: request.id,
      isRead: false,
    });

    if (
      request.collegeFilterId &&
      providerData.collegeId === request.collegeFilterId
    ) {
      await db.insert(bids).values({
        requestId: request.id,
        providerId: providerData.id,
        price: request.desiredPrice,
        isGraduateOfRequestedCollege: true,
        status: 'pending',
      });
    }
  }
}
