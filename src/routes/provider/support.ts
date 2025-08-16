import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../drizzle/db.js';
import { 
  supportTickets, 
  ticketResponses,
  ticketStatusEnum,
  ticketPriorityEnum,
  ticketCategoryEnum
} from '../../drizzle/schema.js';
import { and, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { 
  TSSupportTicket, 
  TSTicketResponse,
  TSUsers
} from '../../drizzle/schema.js';
import { adminRoleAuth, clientRoleAuth } from '../../middleware/bearAuth.js'; 

// Define custom context type extending the base Hono context
type CustomContext = {
  Variables: {
    user: TSUsers & { 
      role: 'admin' | 'service_provider' | 'client';
      id: number;
    };
  };
};

// Extract enum types
type TicketStatus = typeof ticketStatusEnum.enumValues[number];
type TicketPriority = typeof ticketPriorityEnum.enumValues[number];
type TicketCategory = typeof ticketCategoryEnum.enumValues[number];

const app = new Hono<CustomContext>()
  // Admin-only routes
  .get('/', adminRoleAuth, async (c) => {
    // Get all tickets (admin only)
    const tickets = await db.query.supportTickets.findMany({
      with: {
        user: true,
        responses: {
          with: { user: true },
          orderBy: (responses, { asc }) => [asc(responses.createdAt)],
        },
      },
      orderBy: (tickets, { desc }) => [desc(tickets.createdAt)],
    });

    return c.json(tickets);
  })
  .patch('/:id/status', adminRoleAuth, async (c) => {
    // Update ticket status (admin only)
    const id = parseInt(c.req.param('id'));
    const data = await c.req.json();

    const schema = z.object({
      status: z.enum(ticketStatusEnum.enumValues as [string, ...string[]]),
    });

    const validated = schema.parse(data);

    const [ticket] = await db.update(supportTickets)
      .set({ 
        status: validated.status as TicketStatus,
        updatedAt: new Date()
      })
      .where(eq(supportTickets.id, id))
      .returning();

    if (!ticket) {
      throw new HTTPException(404, { message: 'Ticket not found' });
    }

    return c.json(ticket);
  })

  // Client routes
  .get('/user-tickets', clientRoleAuth, async (c) => {
    // Get tickets for current user
    const user = c.get('user');
    
    const tickets = await db.query.supportTickets.findMany({
      where: eq(supportTickets.userId, user.id),
      with: {
        responses: {
          with: { user: true },
          orderBy: (responses, { asc }) => [asc(responses.createdAt)],
        },
      },
      orderBy: (tickets, { desc }) => [desc(tickets.createdAt)],
    });

    return c.json(tickets);
  })
  .post('/', clientRoleAuth, async (c) => {
    // Create new ticket
    const user = c.get('user');
    const data = await c.req.json();

    const schema = z.object({
      title: z.string().min(5).max(255),
      issue: z.string().min(10),
      category: z.enum(ticketCategoryEnum.enumValues as [string, ...string[]]),
      priority: z.enum(ticketPriorityEnum.enumValues as [string, ...string[]]).optional().default('medium'),
    });

    const validated = schema.parse(data);

    const [ticket] = await db.insert(supportTickets).values({
      userId: user.id,
      title: validated.title,
      issue: validated.issue,
      category: validated.category as TicketCategory,
      priority: validated.priority as TicketPriority,
    }).returning();

    return c.json(ticket, 201);
  })

  // Shared routes (both admin and client)
  .get('/:id', async (c) => {
    // Get single ticket
    const user = c.get('user');
    const id = parseInt(c.req.param('id'));
    
    const ticket = await db.query.supportTickets.findFirst({
      where: and(
        eq(supportTickets.id, id),
        user.role === 'admin' 
          ? undefined 
          : eq(supportTickets.userId, user.id)
      ),
      with: {
        user: true,
        responses: {
          with: { user: true },
          orderBy: (responses, { asc }) => [asc(responses.createdAt)],
        },
      },
    });

    if (!ticket) {
      throw new HTTPException(404, { message: 'Ticket not found' });
    }

    return c.json(ticket);
  })
  .post('/:id/respond', async (c) => {
    // Add response to ticket
    const user = c.get('user');
    const id = parseInt(c.req.param('id'));
    const data = await c.req.json();

    const schema = z.object({
      message: z.string().min(1),
    });

    const validated = schema.parse(data);

    // Verify ticket exists and user has access
    const ticket = await db.query.supportTickets.findFirst({
      where: and(
        eq(supportTickets.id, id),
        user.role === 'admin' 
          ? undefined 
          : eq(supportTickets.userId, user.id)
      ),
    });

    if (!ticket) {
      throw new HTTPException(404, { message: 'Ticket not found' });
    }

    const [response] = await db.insert(ticketResponses).values({
      ticketId: id,
      userId: user.id,
      message: validated.message,
      isAdminResponse: user.role === 'admin',
    }).returning();

    // If admin is responding, update ticket status to in_progress
    if (user.role === 'admin' && ticket.status === 'pending') {
      await db.update(supportTickets)
        .set({ status: 'in_progress' as TicketStatus, updatedAt: new Date() })
        .where(eq(supportTickets.id, id));
    }

    return c.json(response, 201);
  });

export default app;