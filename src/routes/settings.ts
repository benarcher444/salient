// Settings, the rules page, and the health check.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentUser, requireUser } from "../context.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { rulesPage, settingsPage } from "../views/pages.js";

const html = "text/html; charset=utf-8";

export function settingsRoutes(app: FastifyInstance) {
  app.get("/settings", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const saved = (request.query as Record<string, string | undefined>).saved;
    return reply.type(html).send(settingsPage(user, saved ? "Saved." : undefined));
  });

  app.post("/preferences/theme", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = z.object({ theme: z.enum(["auto", "light", "dark"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    db.update(users).set({ theme: parsed.data.theme }).where(eq(users.id, user.id)).run();
    return reply.redirect("/settings?saved=1");
  });

  app.post("/preferences/name", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = z.object({ name: z.string().trim().min(2).max(24) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).type(html).send(settingsPage(user, "Display names are 2 to 24 characters."));
    db.update(users).set({ displayName: parsed.data.name }).where(eq(users.id, user.id)).run();
    return reply.redirect("/settings?saved=1");
  });

  app.get("/how-to-play", (request, reply) => reply.type(html).send(rulesPage(currentUser(request))));

  // For the deploy script's check: answers without signing in, touches the database.
  app.get("/healthz", (_request, reply) => {
    db.select({ id: users.id }).from(users).limit(1).all();
    return reply.send("ok");
  });
}
