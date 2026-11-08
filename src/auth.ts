// Accounts: password hashing, sessions, the invite list, lockout and rate limits.
import crypto from "node:crypto";
import fs from "node:fs";
import argon2 from "argon2";
import { and, eq, gt, lt } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { sessions, users, type User } from "./db/schema.js";

export const SESSION_COOKIE = "salient_session";
export const MAX_FAILED_LOGINS = 5;

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

const tokenId = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function createSession(userId: number): { token: string; expiresAt: number } {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + config.sessionDays * 24 * 60 * 60 * 1000;
  db.insert(sessions).values({ id: tokenId(token), userId, createdAt: now, expiresAt }).run();
  return { token, expiresAt };
}

export function userForSession(token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, tokenId(token)), gt(sessions.expiresAt, Date.now())))
    .get();
  return row?.user ?? null;
}

export function endSession(token: string | undefined) {
  if (token) db.delete(sessions).where(eq(sessions.id, tokenId(token))).run();
}

export function pruneSessions() {
  db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * Is this address on the invite list? The file is read on every call so edits
 * apply without a restart, and a missing file lets nobody in: an absent list
 * must fail closed, not open.
 */
export function isInvited(email: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(config.invitesPath, "utf8");
  } catch {
    return false;
  }
  const wanted = normaliseEmail(email);
  return text.split(/\r?\n/).some((line) => {
    const entry = line.replace(/#.*/, "").trim().toLowerCase();
    return entry !== "" && entry === wanted;
  });
}

export type SignInResult = { ok: true; user: User } | { ok: false; reason: "bad_credentials" | "locked" };

/**
 * Check a password. Five wrong in a row locks the account until
 * `npm run unlock -- <email>`. The trade-off, said out loud: anyone who knows
 * an address can lock it, and unlocking needs a shell on the server.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const user = db.select().from(users).where(eq(users.email, normaliseEmail(email))).get();
  if (!user) {
    // Spend the same time as a real check, so response time doesn't reveal
    // which addresses have accounts.
    await argon2.hash(password, { type: argon2.argon2id });
    return { ok: false, reason: "bad_credentials" };
  }
  if (user.lockedAt) return { ok: false, reason: "locked" };
  if (user.isBot) return { ok: false, reason: "bad_credentials" };
  const good = await argon2.verify(user.passwordHash, password);
  if (!good) {
    const failed = user.failedLogins + 1;
    db.update(users)
      .set({ failedLogins: failed, lockedAt: failed >= MAX_FAILED_LOGINS ? Date.now() : null })
      .where(eq(users.id, user.id))
      .run();
    return { ok: false, reason: failed >= MAX_FAILED_LOGINS ? "locked" : "bad_credentials" };
  }
  if (user.failedLogins > 0) db.update(users).set({ failedLogins: 0 }).where(eq(users.id, user.id)).run();
  return { ok: true, user };
}

// --- Rate limiting -----------------------------------------------------------

const hits = new Map<string, number[]>();

/**
 * In-memory sliding window per address and bucket. argon2 is deliberately
 * slow, so a flood of sign-in attempts is a CPU attack as much as a guessing
 * one. Loopback is exempt, or the test suites would lock themselves out.
 */
export function rateLimited(bucket: string, ip: string, max: number, windowMs: number): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return false;
  const k = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(k, recent);
  return recent.length > max;
}
