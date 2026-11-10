// Sign-in, sign-up (by invitation) and sign-out.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { SESSION_COOKIE, createSession, endSession, hashPassword, isInvited, normaliseEmail, rateLimited, signIn } from "../auth.js";
import { currentUser, safeNext } from "../context.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { authPage } from "../views/pages.js";

const QUARTER_HOUR = 15 * 60 * 1000;

export function setSessionCookie(request: FastifyRequest, reply: FastifyReply, userId: number) {
  const { token, expiresAt } = createSession(userId);
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // Secure exactly when the request came over HTTPS, so the app still works
    // over plain HTTP on a home network during development.
    secure: request.protocol === "https",
    expires: new Date(expiresAt),
  });
}

export function authRoutes(app: FastifyInstance) {
  app.get("/login", (request, reply) => {
    if (currentUser(request)) return reply.redirect("/");
    const next = safeNext((request.query as Record<string, unknown>).next);
    return reply.type("text/html").send(authPage({ mode: "login", next }));
  });

  app.post("/login", async (request, reply) => {
    const body = z.object({ email: z.string().max(200), password: z.string().max(500) }).safeParse(request.body);
    if (!body.success) return reply.code(400).type("text/html").send(authPage({ mode: "login", error: "Enter your email and password." }));
    if (rateLimited("login", request.ip, 10, QUARTER_HOUR)) {
      return reply.code(429).type("text/html").send(authPage({ mode: "login", email: body.data.email, error: "Too many attempts. Wait a few minutes and try again." }));
    }
    const result = await signIn(body.data.email, body.data.password);
    if (!result.ok) {
      const error = result.reason === "locked" ? "This account is locked after too many wrong passwords. Ask the server admin to unlock it." : "That email and password don't match.";
      return reply.code(401).type("text/html").send(authPage({ mode: "login", email: body.data.email, error }));
    }
    setSessionCookie(request, reply, result.user.id);
    return reply.redirect(safeNext((request.query as Record<string, unknown>).next));
  });

  app.get("/signup", (request, reply) => {
    if (currentUser(request)) return reply.redirect("/");
    return reply.type("text/html").send(authPage({ mode: "signup" }));
  });

  app.post("/signup", async (request, reply) => {
    const parsed = z
      .object({ email: z.string().max(200), name: z.string().max(100), password: z.string().max(500) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).type("text/html").send(authPage({ mode: "signup", error: "Fill in every field." }));
    const email = normaliseEmail(parsed.data.email);
    const name = parsed.data.name.trim().slice(0, 24);
    const again = (error: string, code = 400) =>
      reply.code(code).type("text/html").send(authPage({ mode: "signup", email, name, error }));
    if (rateLimited("signup", request.ip, 5, 60 * 60 * 1000)) return again("Too many sign-ups from here. Try again later.", 429);
    if (!z.email().safeParse(email).success) return again("That doesn't look like an email address.");
    if (name.length < 2) return again("Pick a display name of at least 2 characters.");
    if (parsed.data.password.length < 8) return again("Use a password of at least 8 characters.");
    if (!isInvited(email)) return again("That address isn't on the invite list.", 403);
    if (db.select().from(users).where(eq(users.email, email)).get()) return again("There's already an account for that address. Sign in instead.", 409);
    const passwordHash = await hashPassword(parsed.data.password);
    const user = db.insert(users).values({ email, displayName: name, passwordHash, createdAt: Date.now() }).returning().get();
    setSessionCookie(request, reply, user.id);
    return reply.redirect("/");
  });

  app.post("/logout", (request, reply) => {
    endSession(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.redirect("/login");
  });
}
