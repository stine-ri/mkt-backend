import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from './schema';
const databaseUrl = process.env.Database_URL;
if (!databaseUrl)
    throw new Error("DATABASE_URL is not set");
const sql = neon(databaseUrl);
export const db = drizzle(sql, { schema, logger: true });
export default db;
