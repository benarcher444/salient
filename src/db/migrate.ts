// Applies pending migrations from drizzle/. Called at boot, before the server
// listens, so a deploy migrates itself; a failure stops the server starting.
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./index.js";

export function runMigrations() {
  migrate(db, { migrationsFolder: path.resolve("drizzle") });
}
