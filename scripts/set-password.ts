// Replace an account's password (passwords cannot be recovered, only replaced).
//   npm run set-password -- <email> <new password>
import "../src/env.js";
import { eq } from "drizzle-orm";
import { hashPassword, normaliseEmail } from "../src/auth.js";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error("Usage: npm run set-password -- <email> <new password of 8+ characters>");
  process.exit(1);
}
const user = db.select().from(users).where(eq(users.email, normaliseEmail(email))).get();
if (!user) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}
db.update(users)
  .set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedAt: null })
  .where(eq(users.id, user.id))
  .run();
console.log(`Password replaced for ${user.email}; the account is unlocked.`);
