// Invite links: /g/<id>/invite/<token>. Anyone with the link can take an open
// seat, as themselves if signed in, otherwise as a guest of that one game.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { rateLimited } from "../auth.js";
import { currentUser, requireUser } from "../context.js";
import { createGuest, dropGuest, inviteMatches, replaceInvite } from "../guest.js";
import { joinGame, loadGame, type LiveGame } from "../games.js";
import { invitePage } from "../views/invite-view.js";
import { notFoundPage } from "../views/pages.js";
import { setSessionCookie } from "./auth.js";

const html = "text/html; charset=utf-8";
const HOUR = 60 * 60 * 1000;

const hasOpenSeat = (live: LiveGame) => !live.game.startedAt && live.players.length < live.game.seatCount;

export function inviteRoutes(app: FastifyInstance) {
  app.get("/g/:id/invite/:token", (request, reply) => {
    const { id, token } = request.params as { id: string; token: string };
    const user = currentUser(request);
    const live = loadGame(id);
    // A wrong or replaced token looks exactly like a missing game.
    if (!live || !inviteMatches(id, token)) return reply.code(404).type(html).send(notFoundPage(user));
    // Already in it (a guest of this game, or a player): straight to the game.
    if (user && live.players.some((p) => p.userId === user.id)) return reply.redirect(`/g/${id}`);
    return reply.type(html).send(invitePage({ live, token, user, open: hasOpenSeat(live) }));
  });

  app.post("/g/:id/invite/:token", (request, reply) => {
    const { id, token } = request.params as { id: string; token: string };
    const live = loadGame(id);
    if (!live || !inviteMatches(id, token)) return reply.code(404).type(html).send(notFoundPage(null));
    // Signed-in players join with their account, through the ordinary join.
    if (currentUser(request)) return reply.redirect(`/g/${id}/invite/${token}`);
    const parsed = z.object({ name: z.string().max(100) }).safeParse(request.body);
    const name = (parsed.success ? parsed.data.name : "").trim().slice(0, 24);
    const again = (error: string, code = 400) =>
      reply.code(code).type(html).send(invitePage({ live, token, user: null, open: hasOpenSeat(live), error, name }));
    if (rateLimited("guest", request.ip, 10, HOUR)) return again("Too many guests from here. Try again later.", 429);
    if (!hasOpenSeat(live)) return again("This game has no free seat any more.", 409);
    if (name.length < 2) return again("Pick a display name of at least 2 characters.");
    const guest = createGuest(name, id);
    const result = joinGame(id, guest.id);
    if (result !== "joined") {
      // Someone took the last seat between the page and the click.
      dropGuest(guest.id);
      return again("This game has no free seat any more.", 409);
    }
    setSessionCookie(request, reply, guest.id);
    return reply.redirect(`/g/${id}`);
  });

  /** A new link for the game; the old one stops working. Players only, guests excepted (the guard refuses them). */
  app.post("/g/:id/invite", (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const { id } = request.params as { id: string };
    const live = loadGame(id);
    if (!live || !live.players.some((p) => p.userId === user.id)) return reply.code(404).type(html).send(notFoundPage(user));
    replaceInvite(id);
    return reply.redirect(`/g/${id}`);
  });
}
