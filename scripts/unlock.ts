// Unlock an account after five wrong passwords.
//   npm run unlock -- <email>
import "../src/env.js";
import { eq } from "drizzle-orm";
import { normaliseEmail } from "../src/auth.js";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run unlock -- <email>");
  process.exit(1);
}
const result = db.update(users).set({ failedLogins: 0, lockedAt: null }).where(eq(users.email, normaliseEmail(email))).run();
console.log(result.changes ? `Unlocked ${email}.` : `No account for ${email}.`);
