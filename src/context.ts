// Who is making this request.
import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE, userForSession } from "./auth.js";
import type { User } from "./db/schema.js";

export function currentUser(request: FastifyRequest): User | null {
  return userForSession(request.cookies[SESSION_COOKIE]);
}

/** The signed-in user, or a redirect to sign-in that comes back here afterwards. */
export function requireUser(request: FastifyRequest, reply: FastifyReply): User | null {
  const user = currentUser(request);
  if (!user) {
    const next = encodeURIComponent(request.url);
    reply.redirect(`/login?next=${next}`);
    return null;
  }
  return user;
}

/**
 * Only follow a `next` that is a path on this site. Anything else — an
 * absolute URL, a protocol-relative `//evil.example` — goes home instead.
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
