// The page an invite link opens: the game, and how to take a seat in it.
import type { User } from "../db/schema.js";
import type { LiveGame } from "../games.js";
import { mapThumbnail, playerList } from "./components.js";
import { NO_AUTOFILL, esc, layout, pageHead, type Html } from "./layout.js";

export interface InviteOptions {
  live: LiveGame;
  token: string;
  /** Signed in with a real account. */
  user: User | null;
  /** A seat is free and the game has not started. */
  open: boolean;
  error?: string;
  name?: string;
}

export function invitePage(o: InviteOptions): Html {
  const { game, map, players } = o.live;
  const self = `/g/${esc(game.id)}/invite/${esc(o.token)}`;
  const signIn = `/login?next=${encodeURIComponent(`/g/${game.id}/invite/${o.token}`)}`;
  let action: Html;
  if (!o.open) {
    action = `<section class="card"><div class="card-body stack">
  <p class="alert alert-danger" role="alert">This game has no free seat any more: it has filled up or already started.</p>
  ${o.user ? `<a class="btn" href="/">Back to your games</a>` : `<a class="btn" href="${esc(signIn)}">Sign in</a>`}
</div></section>`;
  } else if (o.user) {
    action = `<form method="post" action="/g/${esc(game.id)}/join"><button class="btn btn-primary btn-lg block" type="submit">Join this game</button></form>`;
  } else {
    action = `<form class="card" method="post" action="${self}"><div class="card-body stack">
  <h2>Join as a guest</h2>
  <p class="faint">No account needed. You'll play this one game; signing out ends your access to it.</p>
  ${o.error ? `<p class="alert alert-danger" role="alert">${esc(o.error)}</p>` : ""}
  <label class="field"><span>Display name</span><input class="input" id="guest-name" name="name" required minlength="2" maxlength="24" value="${esc(o.name ?? "")}" ${NO_AUTOFILL}></label>
  <button class="btn btn-primary btn-lg" type="submit">Join as guest</button>
  <p class="faint center">Have an account? <a href="${esc(signIn)}">Sign in</a> to join with it.</p>
</div></form>`;
  }
  const body = `${pageHead({ title: map.name, sub: `You're invited · ${players.length} of ${game.seatCount} seats filled` })}
<div class="waiting">
  <div class="card waiting-map">${mapThumbnail(map)}</div>
  <div class="stack">
    <section class="card"><div class="card-head"><h2>Players</h2></div><div class="card-body">${playerList(players, game.seatCount)}</div></section>
    ${action}
  </div>
</div>`;
  return layout({ title: `Join ${map.name}`, body, user: o.user });
}
