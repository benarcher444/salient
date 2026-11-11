// Markup for the ordinary pages: sign-in, the lobby, settings, the rules.
import { keyHelpHtml } from "../game/keys.js";
import { APP_NAME } from "../config.js";
import type { User } from "../db/schema.js";
import { MAPS } from "../game/maps.js";
import { RULES } from "../game/constants.js";
import { seatName } from "../game/seats.js";
import type { GameSummary, LiveGame } from "../games.js";
import type { MapDef } from "../game/types.js";
import { mapThumbnail, playerList, seatChip, unitCards } from "./components.js";
import { icons } from "./icons.js";
import { NO_AUTOFILL, esc, layout, pageHead, type Html, type Theme } from "./layout.js";

export function authPage(o: { mode: "login" | "signup"; error?: string; email?: string; name?: string; next?: string }): Html {
  const signup = o.mode === "signup";
  const action = o.next && o.next !== "/" ? `/${o.mode}?next=${encodeURIComponent(o.next)}` : `/${o.mode}`;
  const body = `<div class="auth-wrap">
  <div class="auth-hero">${icons.logo}<h1>${APP_NAME}</h1><p>Turn-based tactics. Take the command posts, hold the line, read the fog.</p></div>
  <form class="card auth-card" method="post" action="${esc(action)}">
    <div class="card-body stack">
      <h2>${signup ? "Create your account" : "Sign in"}</h2>
      ${signup ? '<p class="faint">Sign-up is by invitation. Use the address you were invited with.</p>' : ""}
      ${o.error ? `<p class="alert alert-danger" role="alert">${esc(o.error)}</p>` : ""}
      <label class="field"><span>Email</span><input class="input" id="email" name="email" type="email" required autocomplete="email" autocapitalize="none" value="${esc(o.email ?? "")}"></label>
      ${signup ? `<label class="field"><span>Display name</span><input class="input" id="name" name="name" required maxlength="24" ${NO_AUTOFILL} value="${esc(o.name ?? "")}"></label>` : ""}
      <label class="field"><span>Password</span><input class="input" id="password" name="password" type="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? "new-password" : "current-password"}"></label>
      <button class="btn btn-primary btn-lg" type="submit">${signup ? "Create account" : "Sign in"}</button>
      <p class="faint center">${signup ? 'Already have an account? <a href="/login">Sign in</a>' : 'Been invited? <a href="/signup">Create an account</a>'}</p>
    </div>
  </form>
</div>`;
  return layout({ title: signup ? "Sign up" : "Sign in", body, user: null });
}

function statusPill(s: GameSummary): Html {
  const g = s.game;
  if (g.status === "open") return `<span class="pill">Waiting for players · ${s.players.length}/${g.seatCount}</span>`;
  if (g.status === "over") {
    if (g.winnerSeat === null) return `<span class="pill">Draw</span>`;
    return g.winnerSeat === s.mySeat ? `<span class="pill pill-ok">Victory</span>` : `<span class="pill">Won by ${esc(seatName(g.winnerSeat))}</span>`;
  }
  if (s.yourMove) return `<span class="pill pill-warn">Your move</span>`;
  return `<span class="pill">Round ${g.round} · ${g.phase === "attack" ? "attacks" : "planning"}</span>`;
}

function gameCard(s: GameSummary, join = false, userId?: number): Html {
  const map = s.map;
  const players = s.players.map((p) => seatChip(p.seat, p.name)).join("");
  const open = join
    ? `<form method="post" action="/g/${esc(s.game.id)}/join"><button class="btn btn-primary btn-sm" type="submit">Join</button></form>`
    : `<a class="btn btn-sm${s.yourMove ? " btn-primary" : ""}" href="/g/${esc(s.game.id)}">${s.game.status === "over" ? "Review" : "Open"}</a>`;
  // The creator can delete a game at any stage; it asks first.
  const remove =
    !join && userId !== undefined && s.game.createdBy === userId
      ? `<a class="btn btn-ghost btn-sm" href="/g/${esc(s.game.id)}/delete" aria-label="Delete game #${esc(s.game.id)}">Delete</a>`
      : "";
  // A finished game can be watched again from the start, fog lifted.
  const replay = !join && s.game.status === "over" ? `<a class="btn btn-sm" href="/g/${esc(s.game.id)}?replay=1">Replay</a>` : "";
  const action = `<div class="btn-row">${remove}${replay}${open}</div>`;
  return `<article class="card game-card${s.yourMove ? " your-move" : ""}">
  <a class="game-card-map" href="/g/${esc(s.game.id)}" tabindex="-1">${map ? mapThumbnail(map, false) : ""}</a>
  <div class="game-card-body">
    <div class="game-card-title"><h3>${esc(map?.name ?? s.game.mapId)}</h3>${statusPill(s)}</div>
    <div class="chips">${players}</div>
    <div class="game-card-foot"><span class="faint mono">#${esc(s.game.id)}</span>${action}</div>
  </div>
</article>`;
}

export function lobbyPage(user: User, mine: GameSummary[], open: GameSummary[], ownMaps: MapDef[], error?: string, notice?: string): Html {
  const active = mine.filter((s) => s.game.status !== "over");
  const finished = mine.filter((s) => s.game.status === "over");
  const mapOptions = [...MAPS, ...ownMaps].map(
    (m, i) => `<label class="map-option">
  <input type="radio" name="map" value="${esc(m.id)}"${i === 0 ? " checked" : ""} data-seats="${m.seats}">
  <span class="map-option-card">${mapThumbnail(m, false)}<span class="map-option-text"><strong>${esc(m.name)}</strong><small>${m.seats === 2 ? "2 players" : `2–${m.seats} players`} · ${m.width}×${m.height}</small><small class="faint">${esc(m.blurb)}</small></span></span>
</label>`,
  ).join("");

  const body = `${pageHead({ title: "Your games", sub: `Signed in as ${user.displayName}.` })}
${error ? `<p class="alert alert-danger" role="alert">${esc(error)}</p>` : ""}
${notice ? `<p class="alert alert-ok" role="status">${esc(notice)}</p>` : ""}
<div class="lobby">
  <section class="lobby-main stack">
    ${
      active.length
        ? `<div class="game-list">${active.map((s) => gameCard(s, false, user.id)).join("")}</div>`
        : `<div class="card empty"><div class="empty-icon">${icons.flag}</div><h3>No games yet</h3><p>Start a new game below and send the link to a friend, or join an open one.</p></div>`
    }
    ${open.length ? `<h2 class="section-title">Open games</h2><div class="game-list">${open.map((s) => gameCard(s, true)).join("")}</div>` : ""}
    ${finished.length ? `<h2 class="section-title">Finished</h2><div class="game-list">${finished.map((s) => gameCard(s, false, user.id)).join("")}</div>` : ""}
  </section>
  <aside class="lobby-side">
    <form class="card" method="post" action="/games" id="new-game">
      <div class="card-head"><h2>New game</h2></div>
      <div class="card-body stack">
        <fieldset class="map-options"><legend class="sr-only">Map</legend>${mapOptions}</fieldset>
        <fieldset class="segmented"><legend>Opponents</legend>
          <label><input type="radio" name="opponents" value="bots" checked><span>${icons.cpu}Computer</span></label>
          <label><input type="radio" name="opponents" value="people"><span>${icons.users}Friends</span></label>
        </fieldset>
        <label class="field"><span>Players</span>
          <select class="select" name="seats" id="seats">
            ${Array.from({ length: (MAPS[0]?.seats ?? 2) - 1 }, (_, i) => `<option value="${i + 2}">${i + 2} players</option>`).join("")}
          </select>
        </label>
        <button class="btn btn-primary btn-lg" type="submit">${icons.plus}<span>Create game</span></button>
        <p class="faint small">Computer opponents start straight away. With friends you get a link to share, and the game starts when every seat is filled.</p>
      </div>
    </form>
  </aside>
</div>`;
  return layout({
    title: "Games",
    body,
    user,
    active: "games",
    scripts: `<script type="module" src="/static/lobby.js"></script>`,
  });
}

export function waitingRoom(user: User, s: GameSummary, shareUrl: string): Html {
  const map = s.map;
  const isCreator = s.game.createdBy === user.id;
  const body = `${pageHead({ title: map.name, sub: `Waiting for players · ${s.players.length} of ${s.game.seatCount} seats filled` })}
<div class="waiting">
  <div class="card waiting-map">${mapThumbnail(map)}</div>
  <div class="stack">
    <section class="card"><div class="card-head"><h2>Players</h2></div><div class="card-body">${playerList(s.players, s.game.seatCount)}</div></section>
    ${
      s.mySeat === null
        ? `<form method="post" action="/g/${esc(s.game.id)}/join"><button class="btn btn-primary btn-lg block" type="submit">Join this game</button></form>`
        : `<section class="card"><div class="card-head"><h2>Invite</h2></div><div class="card-body stack">
      <p class="faint">Send this link. Anyone with it can take a seat, without an account if need be (as a guest, for this game only). The game starts as soon as the last seat is taken.</p>
      <div class="share"><input class="input mono" id="share-url" readonly value="${esc(shareUrl)}" ${NO_AUTOFILL}><button class="btn" type="button" id="copy-link">${icons.link}<span>Copy</span></button></div>
      ${user.isGuest ? "" : `<form method="post" action="/g/${esc(s.game.id)}/invite"><button class="btn btn-ghost btn-sm" type="submit" id="new-link">New link (the old one stops working)</button></form>`}
    </div></section>
    ${user.isGuest ? "" : `<form method="post" action="/g/${esc(s.game.id)}/leave"><button class="btn btn-ghost" type="submit">${icons.exit}<span>${isCreator ? "Cancel game" : "Leave game"}</span></button></form>`}`
    }
  </div>
</div>`;
  return layout({
    title: map.name,
    body,
    user,
    active: "games",
    // Classic script for the data, module for the code: a module's imports
    // are hoisted above its body, so data assigned in the same module would
    // arrive after the code that reads it.
    scripts: `<script>window.SALIENT_WAIT = {"gameId":${JSON.stringify(s.game.id)}};</script><script type="module" src="/static/waiting.js"></script>`,
  });
}

export function settingsPage(user: User, notice?: string): Html {
  const choice = (t: Theme, label: string, icon: string) =>
    `<button class="btn theme-btn" name="theme" value="${t}" aria-pressed="${user.theme === t}">${icon}<span>${label}</span></button>`;
  const body = `${pageHead({ title: "Settings" })}
${notice ? `<p class="alert alert-ok" role="status">${esc(notice)}</p>` : ""}
<div class="settings stack">
  <form class="card" method="post" action="/preferences/theme">
    <div class="card-head"><h2>Appearance</h2><p class="sub">Saved to your account, so it follows you between devices.</p></div>
    <div class="card-body"><div class="theme-switch">${choice("auto", "Device", icons.monitor)}${choice("light", "Light", icons.sun)}${choice("dark", "Dark", icons.moon)}</div></div>
  </form>
  <form class="card" method="post" action="/preferences/name">
    <div class="card-head"><h2>Display name</h2><p class="sub">What other players see.</p></div>
    <div class="card-body row-form"><input class="input" name="name" required maxlength="24" value="${esc(user.displayName)}" ${NO_AUTOFILL}><button class="btn btn-primary" type="submit">Save</button></div>
  </form>
  <form class="card" method="post" action="/logout">
    <div class="card-head"><h2>Account</h2><p class="sub">${esc(user.email)}</p></div>
    <div class="card-body"><button class="btn btn-ghost" type="submit">${icons.exit}<span>Sign out</span></button></div>
  </form>
</div>`;
  return layout({ title: "Settings", body, user, active: "settings" });
}

export function rulesPage(user: User | null): Html {
  const body = `${pageHead({ title: "How to play", sub: "Everything the game does, in one page." })}
<div class="rules stack">
  <section class="card"><div class="card-body prose">
    <h2>The goal</h2>
    <p><strong>Take their base.</strong> Every side starts with a small base: a few tiles it deploys onto. Base tiles are captured one at a time, and slowly: hold an enemy's base tile for ${RULES.baseCaptureRounds} rounds and it turns neutral; hold it ${RULES.baseCaptureRounds} more and it's yours, and you can deploy on it. An <strong>engineer</strong> does each step in ${RULES.engineerBaseCaptureRounds === 1 ? "one round" : `${RULES.engineerBaseCaptureRounds} rounds`}. Step off, or get shot off, and the progress is lost; a bar on the tile shows how far along it is. A side with <strong>no base tiles and no units left is out</strong>. The last side standing wins${RULES.roundLimit > 0 ? `; if ${RULES.roundLimit} rounds pass, it's a draw` : "; there is no round limit"}.</p>
    <h2>A round</h2>
    <ol class="steps">
      <li><strong>Plan.</strong> Everyone plans at the same time, in secret. Buy units onto any base tile or command post you hold, and give each unit a route and a facing. Pick a tile further than a unit can go in one round and it heads there over several: this round it walks as far as it can, the rest of the way shows faintly with a number where each later round ends, and every new round starts with its next leg already planned (change it, or cancel the route, as you like). Lock in when ready.</li>
      <li><strong>Move, then deploy.</strong> Moves resolve first, then new units land: a deployment onto a tile someone has just walked onto fails, and its gold comes back.</li>
      <li><strong>Move.</strong> When the last player locks in, all routes play out together, one step at a time. Your own units walk through each other freely, but no two can finish on the same tile. Units of different sides heading for the same tile both stop, and so does anyone who walks into an enemy they couldn't see.</li>
      <li><strong>Attack.</strong> Players take turns firing one unit at a time (a commando takes both its shots in its turn). A unit that fires can't move in the next round, only turn. The first shot rotates each round. Units with nothing in reach are skipped automatically.</li>
      <li><strong>Upkeep.</strong> Captures (base tiles, posts, income sites), income and healing. Anyone left with no base tiles and no units is knocked out.</li>
    </ol>
    <h2>Shooting</h2>
    <p>A unit can shoot what is inside its <strong>firing arc</strong> (the wedge in front of it), within range, with a clear line: walls stop shots, and so does any enemy standing in the way. Your own units don't: you shoot past them. An enemy you can't see (a hidden commando, someone in the fog mid-way along a long shot) takes the shot instead of your target. You see the chance to hit before you fire. Accuracy falls off past a unit's best range. A target behind cover — a crate, a low wall or window, or standing in woods — is harder to hit; cover right next to the shooter costs nothing.</p>
    <p>Before you fire you see the chance to hit and the damage a hit will do: damage varies by up to ${Math.round(RULES.damageVariance * 100)} per cent either way. ${Math.round(RULES.critChance * 100)} per cent of hits are critical, for ${RULES.critMultiplier}× more.</p>
    <p><strong>Facing matters.</strong> A unit can face any direction. ${RULES.flank.side === RULES.flank.front ? `Shots into its back do ${RULES.flank.rear}× damage (from the side, the same as from the front).` : `Shots into its side do ${RULES.flank.side}× damage and into its back ${RULES.flank.rear}×.`} With a mouse, click a unit and it turns to follow the pointer: right-click to set its facing there (and deselect it), or left-click a tile to move it there, after which it follows the pointer again until you right-click. On a touch screen, tap where it should face instead. The compass in the panel and Q and E turn it too.</p>
    <h2>The map</h2>
    <ul>
      <li><strong>Walls</strong> stop movement and sight. <strong>Windows and low walls</strong> stop movement but you can see and shoot through them. Doorways are open.</li>
      <li><strong>Rock</strong> blocks both; <strong>water</strong> and <strong>crates</strong> block movement only; <strong>woods</strong> cost double to walk through and give cover.</li>
      <li><strong>Command posts</strong> are captured by ending a round on them: an enemy's becomes neutral, a neutral one becomes yours. You can deploy on a post you hold (on the post's own tile only). Posts are forward spawn points; they don't keep you in the game on their own.</li>
      <li><strong>Base tiles</strong> are captured the same way, one tile at a time, and become spawn points for whoever holds them. A unit standing on its own base tile blocks the capture.</li>
      <li><strong>Income sites</strong> pay +25 gold a round, on top of everyone's +${RULES.baseIncome}. Only <strong>engineers</strong> can capture them.</li>
      <li><strong>Fog of war:</strong> you only see what your units and the base tiles and posts you hold can see.</li>
    </ul>
    <h2>Replays</h2>
    <p>A finished game can be watched again from the start with the fog lifted: <strong>Replay</strong> on its card in your games, or <strong>Watch the replay</strong> at the end of the game. It plays a step every two seconds, with the moves and shots animated; pause it, step back and forth, or speed it up.</p>
    <h2>Reading the board</h2>
    <p>Each class has its own shape, and the white arrow in front of a unit shows which way it faces. A pulsing ring marks your units still to act: in planning, the ones that can move and have no orders yet; in the attack phase, the ones that can fire. Point at any unit, yours or an enemy's, to see its firing arc. A sniper with a tripod badge is braced: it hasn't moved this round, so it shoots at full accuracy. A healer or officer shows the square its help reaches when you point at it.</p>
    <h2>Keyboard</h2>
    <p>The whole game can be played from the keyboard. A cursor square is always on the map; keys act on it. Press <kbd>?</kbd> during a game for this list.</p>
    ${keyHelpHtml()}
  </div></section>
  <h2 class="section-title">Units</h2>
  ${unitCards()}
</div>`;
  return layout({ title: "How to play", body, user, active: "rules" });
}

/** "Delete this game?": its map, its players and how far it got, then Delete or Keep. */
export function deleteGamePage(user: User, live: LiveGame): Html {
  const g = live.game;
  const stage = g.status === "open" ? "waiting for players" : g.status === "over" ? "finished" : `in round ${g.round}`;
  const others = live.players.filter((p) => p.userId !== user.id && !p.isBot);
  const body = `${pageHead({ title: "Delete this game?", sub: `${live.map.name} · #${g.id} · ${stage}` })}
<div class="card narrow"><div class="card-body stack">
  <div class="waiting-map">${mapThumbnail(live.map, false)}</div>
  <div class="chips">${live.players.map((p) => seatChip(p.seat, p.name)).join("")}</div>
  <p>The game and its whole history are deleted for everyone in it${others.length ? `, including ${others.map((p) => esc(p.name)).join(", ")}` : ""}. This can't be undone.</p>
  <div class="btn-row">
    <form method="post" action="/g/${esc(g.id)}/delete"><button class="btn btn-danger" type="submit">Delete game</button></form>
    <a class="btn" href="/">Keep it</a>
  </div>
</div></div>`;
  return layout({ title: "Delete game", body, user });
}

export function notFoundPage(user: User | null): Html {
  return layout({
    title: "Not found",
    user,
    body: `<div class="card empty"><div class="empty-icon">${icons.target}</div><h3>Nothing here</h3><p>That page or game doesn't exist. It may have been cancelled.</p><a class="btn btn-primary" href="/">Back to your games</a></div>`,
  });
}
