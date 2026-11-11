// The lobby, a game's page, and the live connection a game page holds open.
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { currentUser, requireUser } from "../context.js";
import { mapForNewGame, listMaps } from "../saved-maps.js";
import { ERROR_TEXT, RuleError, type Facing, type Orders } from "../game/types.js";
import { eventsFor, viewFor, type PlayerView } from "../game/view.js";
import { act, createGame, deleteGame, gamesFor, inGame, joinGame, leaveGame, loadGame, openGames, replayLog, subscribe, type ClientAction, type LiveGame } from "../games.js";
import { clientMessage } from "../protocol.js";
import { inviteTokenFor } from "../guest.js";
import { battlePage } from "../views/game-view.js";
import { deleteGamePage, lobbyPage, notFoundPage, waitingRoom } from "../views/pages.js";

const html = "text/html; charset=utf-8";

export function gameRoutes(app: FastifyInstance) {
  app.get("/", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const query = request.query as Record<string, string | undefined>;
    const ownMaps = listMaps(user.id).filter((e) => e.problems.length === 0).map((e) => e.map);
    const notice = query.deleted ? "Game deleted." : undefined;
    return reply
      .type(html)
      .send(lobbyPage(user, gamesFor(user.id), openGames(user.id), ownMaps, query.error === "full" ? "That game has already filled up." : undefined, notice));
  });

  app.post("/games", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = z
      .object({ map: z.string(), seats: z.coerce.number().int().min(2).max(4), opponents: z.enum(["people", "bots"]).default("people") })
      .safeParse(request.body);
    // A built-in map, or one of this user's own maps that is playable.
    const map = parsed.success ? mapForNewGame(parsed.data.map, user.id) : null;
    if (!parsed.success || !map) return reply.code(400).send({ error: "bad_request" });
    const id = createGame(user.id, map, Math.min(parsed.data.seats, map.seats), parsed.data.opponents === "bots");
    return reply.redirect(`/g/${id}`);
  });

  app.get("/g/:id", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const live = loadGame(id);
    if (!live) return reply.code(404).type(html).send(notFoundPage(user));
    const seat = live.players.find((p) => p.userId === user.id)?.seat ?? null;
    if (!live.state) {
      // The invite link lets anyone with it take a seat, as a guest if they have no account.
      const shareUrl = `${request.protocol}://${request.host}/g/${id}/invite/${inviteTokenFor(id)}`;
      return reply.type(html).send(waitingRoom(user, { game: live.game, map: live.map, players: live.players, mySeat: seat, yourMove: false }, shareUrl));
    }
    // Outsiders may look at a finished game, never one in progress: they
    // would see through everyone's fog.
    if (seat === null && live.state.phase !== "over") return reply.code(403).type(html).send(notFoundPage(user));
    return reply.type(html).send(battlePage(user, live, seat));
  });

  // A finished game's whole log, for the replay. Never one in progress: the
  // log is everyone's moves, fog or no fog.
  app.get("/g/:id/replay", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    if (!loadGame(id)) return reply.code(404).send({ error: "not_found" });
    const log = replayLog(id);
    if (!log) return reply.code(403).send({ error: "not_over" });
    return reply.header("cache-control", "private, max-age=3600").send(log);
  });

  app.post("/g/:id/join", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const result = joinGame(id, user.id);
    if (result === "not_found") return reply.code(404).type(html).send(notFoundPage(user));
    if (result === "full") return reply.redirect("/?error=full");
    return reply.redirect(`/g/${id}`);
  });

  // Deleting asks first, on a page of its own (no browser pop-up), then posts.
  app.get("/g/:id/delete", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const live = loadGame((request.params as { id: string }).id);
    if (!live || live.game.createdBy !== user.id) return reply.code(404).type(html).send(notFoundPage(user));
    return reply.type(html).send(deleteGamePage(user, live));
  });

  app.post("/g/:id/delete", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const result = deleteGame((request.params as { id: string }).id, user.id);
    if (result !== "deleted") return reply.code(404).type(html).send(notFoundPage(user));
    return reply.redirect("/?deleted=1");
  });

  app.post("/g/:id/leave", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    leaveGame((request.params as { id: string }).id, user.id);
    return reply.redirect("/");
  });

  app.get("/ws/g/:id", { websocket: true }, (socket: WebSocket, request) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const initial = loadGame(id);
    if (!user || !initial) {
      socket.close(4404, "not found");
      return;
    }
    const seatOf = (live: LiveGame) => live.players.find((p) => p.userId === user.id)?.seat ?? null;
    let lastView: PlayerView | null = null;

    const send = (message: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    const push = (live: LiveGame, events: Parameters<typeof eventsFor>[0]) => {
      if (live.players.length === 0) return send({ type: "closed" });
      const seat = seatOf(live);
      if (!live.state) return send({ type: "lobby", players: live.players.map((p) => ({ seat: p.seat, name: p.name })) });
      if (seat === null && live.state.phase !== "over") return socket.close(4403, "not a player");
      const state = live.state;
      const view = inGame(live, () => viewFor(state, seat));
      send({
        type: "state",
        view,
        events: eventsFor(events, seat, lastView, view),
        players: live.players.map((p) => ({ seat: p.seat, name: p.name })),
      });
      lastView = view;
    };

    push(initial, []);
    const unsubscribe = subscribe(id, (live, events) => push(live, events));

    socket.on("message", (raw: Buffer) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return send({ type: "error", code: "bad_request", message: "That message couldn't be read." });
      }
      const parsed = clientMessage.safeParse(data);
      if (!parsed.success) return send({ type: "error", code: "bad_request", message: "That message wasn't understood." });
      try {
        const a = parsed.data.action;
        const action: ClientAction =
          a.type === "orders"
            ? { type: "orders", orders: normaliseOrders(a.orders) }
            : a;
        act(id, user.id, action);
      } catch (e) {
        if (e instanceof RuleError) return send({ type: "error", code: e.code, message: ERROR_TEXT[e.code] });
        request.log.error(e, "game action failed");
        send({ type: "error", code: "server_error", message: "Something went wrong on the server. Try again." });
      }
    });
    socket.on("close", unsubscribe);
  });
}

/** zod gives facings as plain numbers; the rules want the Facing type. Already range-checked. */
function normaliseOrders(o: {
  moves: { unitId: number; path: { x: number; y: number }[]; facing: number }[];
  spawns: { kind: Orders["spawns"][number]["kind"]; x: number; y: number; facing: number }[];
  routes?: { unitId: number; to: { x: number; y: number } }[];
}): Orders {
  return {
    moves: o.moves.map((m) => ({ ...m, facing: m.facing as Facing })),
    spawns: o.spawns.map((s) => ({ ...s, facing: s.facing as Facing })),
    // Only when sent, so orders from before routes are logged as they were.
    ...(o.routes ? { routes: o.routes } : {}),
  };
}
