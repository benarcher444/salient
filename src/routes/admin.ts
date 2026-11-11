// The owner's read-only window on stored games, for reviewing them from a
// development machine (`npm run fetch-game`). Off unless ADMIN_TOKEN is set;
// the token goes in an Authorization header, never the URL, so it stays out
// of logs and history. Nothing here writes.
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { games } from "../db/schema.js";
import { fullLog, loadGame } from "../games.js";

const MIN_TOKEN = 32;

function authorised(request: FastifyRequest): boolean {
  const token = process.env.ADMIN_TOKEN ?? "";
  if (token.length < MIN_TOKEN) return false;
  const given = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

export function adminRoutes(app: FastifyInstance) {
  // Unauthorised requests get a plain 404: the routes don't admit to existing.
  app.get("/admin/games", (request, reply) => {
    if (!authorised(request)) return reply.code(404).send({ error: "not_found" });
    const limit = Math.min(200, Math.max(1, Number((request.query as { limit?: string }).limit ?? 20) || 20));
    const rows = db.select().from(games).orderBy(desc(games.updatedAt)).limit(limit).all();
    return rows.map((g) => ({
      id: g.id,
      map: loadGame(g.id)?.map.name ?? g.mapId,
      status: g.status,
      round: g.round,
      seatCount: g.seatCount,
      winnerSeat: g.winnerSeat,
      players: loadGame(g.id)?.players.map((p) => ({ seat: p.seat, name: p.name, isBot: p.isBot })) ?? [],
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    }));
  });

  // One game, whole: its log (in progress too: this is the owner), map
  // snapshot, tuning snapshot and players. The shape scripts/analyse-game.ts reads.
  app.get("/admin/games/:id", (request, reply) => {
    if (!authorised(request)) return reply.code(404).send({ error: "not_found" });
    const { id } = request.params as { id: string };
    const live = loadGame(id);
    const log = live && fullLog(id);
    if (!live || !log) return reply.code(404).send({ error: "not_found" });
    return {
      log,
      game: {
        gameId: id,
        mapId: live.map.id,
        map: live.map,
        tuning: live.tuning,
        players: live.players.map((p) => ({ seat: p.seat, name: p.name, isBot: p.isBot })),
        status: live.game.status,
      },
    };
  });
}
