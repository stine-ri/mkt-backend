import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { colleges } from '../../drizzle/schema.js';

const app = new Hono();

// GET /api/colleges - Fetch all colleges
app.get('/', async (c) => {
  const collegeList = await db.select().from(colleges);
  return c.json(collegeList);
});

//delete

export default app;
