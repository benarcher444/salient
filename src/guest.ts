// Guests: people who join one game through its invite link, without an
// account. A guest is a users row flagged is_guest, tied to that game, with no
// password; the request guard below keeps their session to that game alone.
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db/index.js";
import { games, users, type User } from "./db/schema.js";
import { currentUser } from "./context.js";
import { guestMayRequest } from "./guest-paths.js";

/**
 * Runs before every route (an onRequest hook in server.ts). A guest asking
 * for anything but their own game is sent back to it (a page) or refused (an
 * action or a socket). Enforced here, centrally, rather than by each route,
 * so a route added later is closed to guests by default.
 */
export async function guestGuard(request: FastifyRequest, reply: FastifyReply) {
  const user = currentUser(request);
  if (!user?.isGuest) return;
  const gameId = user.guestGameId ?? "";
  if (guestMayRequest(request.method, request.url, gameId)) return;
  const path = request.url.split("?")[0]!;
  const page = (request.method === "GET" || request.method === "HEAD") && !path.startsWith("/ws/");
  if (page && gameId) return reply.redirect(`/g/${gameId}`);
  return reply.code(403).send({ error: "guest_not_allowed" });
}

/**
 * The game's invite secret, made the first time it is asked for. Read from
 * the database, never a cached game record: the cache can predate the token.
 */
export function inviteTokenFor(gameId: string): string {
  return storedToken(gameId) ?? replaceInvite(gameId);
}

const storedToken = (gameId: string) =>
  db.select({ token: games.inviteToken }).from(games).where(eq(games.id, gameId)).get()?.token ?? null;

/** A new invite secret for the game. Every older link stops working. */
export function replaceInvite(gameId: string): string {
  const token = crypto.randomBytes(18).toString("base64url"); // 144 bits
  db.update(games).set({ inviteToken: token }).where(eq(games.id, gameId)).run();
  return token;
}

/** Does this token open this game's invite? Compared in constant time. */
export function inviteMatches(gameId: string, token: string): boolean {
  const stored = storedToken(gameId);
  if (!stored) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * A guest for this game. The email column is unique and required, so a guest
 * gets an address under .invalid (a reserved domain that can never receive
 * mail or match a real sign-up), and "!" as a password hash, which no
 * password verifies against; signIn refuses guests outright as well.
 */
export function createGuest(displayName: string, gameId: string): User {
  const email = `guest-${crypto.randomBytes(9).toString("hex")}@guest.invalid`;
  return db
    .insert(users)
    .values({ email, displayName, passwordHash: "!", isGuest: true, guestGameId: gameId, createdAt: Date.now() })
    .returning()
    .get();
}

/** Remove a guest that never got a seat (the game filled in the meantime). */
export function dropGuest(userId: number) {
  db.delete(users).where(eq(users.id, userId)).run();
}
