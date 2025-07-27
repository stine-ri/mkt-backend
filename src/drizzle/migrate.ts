import { migrate } from "drizzle-orm/neon-http/migrator";
import { db } from "./db.js";

// Fix __dirname in ESM
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Resolve __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migration() {
  try {
    console.log("======Migration Started ======");
    await migrate(db, {
      migrationsFolder: resolve(__dirname, "migrations"), // Properly resolved
    });
    console.log("======Migration Ended======");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed with error: ", error);
    process.exit(1);
  }
}

migration().catch((e) => {
  console.error("Unexpected error during migration:", e);
  process.exit(1);
});
