// The map editor: your maps, making one, editing (autosaved as JSON), deleting,
// and starting a game against the computer on one.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../context.js";
import { createGame } from "../games.js";
import { createMap, deleteMap, getOwnMap, listMaps, mapBody, saveMap } from "../saved-maps.js";
import { editorPage, mapsPage } from "../views/maps-view.js";
import { notFoundPage } from "../views/pages.js";

const html = "text/html; charset=utf-8";

export function mapRoutes(app: FastifyInstance) {
  app.get("/maps", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const error = (request.query as Record<string, string | undefined>).error;
    return reply.type(html).send(mapsPage(user, listMaps(user.id), error));
  });

  app.post("/maps", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = z.object({ from: z.string().max(40).default("blank") }).safeParse(request.body);
    const id = parsed.success ? createMap(user.id, parsed.data.from) : null;
    if (!id) return reply.code(400).type(html).send(notFoundPage(user));
    return reply.redirect(`/maps/${id}`);
  });

  app.get("/maps/:id", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const entry = getOwnMap((request.params as { id: string }).id, user.id);
    if (!entry) return reply.code(404).type(html).send(notFoundPage(user));
    return reply.type(html).send(editorPage(user, entry));
  });

  // Autosave from the editor. JSON in, the map's problems out.
  app.put("/maps/:id", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = mapBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_map", detail: parsed.error.issues[0]?.message });
    const saved = saveMap((request.params as { id: string }).id, user.id, parsed.data);
    if (!saved) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true, problems: saved.problems, updatedAt: saved.row.updatedAt });
  });

  app.post("/maps/:id/delete", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    deleteMap((request.params as { id: string }).id, user.id);
    return reply.redirect("/maps");
  });

  // Try a map out: a game against the computer with every seat it has.
  app.post("/maps/:id/play", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const entry = getOwnMap((request.params as { id: string }).id, user.id);
    if (!entry) return reply.code(404).type(html).send(notFoundPage(user));
    if (entry.problems.length) return reply.redirect(`/maps?error=unplayable`);
    const id = createGame(user.id, entry.map, entry.map.seats, true);
    return reply.redirect(`/g/${id}`);
  });
}
