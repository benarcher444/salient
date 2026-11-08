// Settings read from the environment, each with a default so a fresh clone
// runs with no .env at all.
import path from "node:path";

export const APP_NAME = "Salient";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "127.0.0.1",
  isProduction: process.env.NODE_ENV === "production",
  databasePath: process.env.DATABASE_PATH ?? path.resolve("data", "app.db"),
  /** One email address per line. Missing file = nobody may sign up. */
  invitesPath: process.env.INVITES_PATH ?? path.resolve("invites.txt"),
  sessionDays: 30,
};
