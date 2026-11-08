// The battle page: a canvas and a side panel, both driven by public/build/game.js.
import type { User } from "../db/schema.js";
import type { LiveGame } from "../games.js";
import { mapById } from "./components.js";
import { icons } from "./icons.js";
import { esc, jsonScript, layout, type Html } from "./layout.js";

export function battlePage(user: User, live: LiveGame, seat: number | null): Html {
  const map = mapById(live.game.mapId)!;
  const boot = {
    gameId: live.game.id,
    mapId: live.game.mapId,
    seat,
    players: live.players.map((p) => ({ seat: p.seat, name: p.name })),
  };
  const body = `<div class="battle" id="battle">
  <header class="battle-bar">
    <a class="btn btn-ghost btn-icon" href="/" aria-label="Back to your games">${icons.back}</a>
    <div class="battle-title"><strong>${esc(map.name)}</strong><span id="phase-label">Connecting…</span></div>
    <div class="scoreboard" id="scoreboard" aria-label="Tickets"></div>
    <div class="gold-pill" id="gold" hidden></div>
  </header>
  <div class="battle-main">
    <div class="board-wrap" id="board-wrap">
      <canvas id="board" aria-label="Battle map"></canvas>
      <div class="board-tooltip" id="tooltip" hidden></div>
      <div class="board-banner" id="banner" hidden></div>
      <div class="zoom-controls">
        <button class="btn btn-icon" id="zoom-in" type="button" aria-label="Zoom in">+</button>
        <button class="btn btn-icon" id="zoom-out" type="button" aria-label="Zoom out">−</button>
        <button class="btn btn-icon" id="zoom-fit" type="button" aria-label="Fit map to screen">${icons.target}</button>
      </div>
    </div>
    <aside class="panel" id="panel" aria-live="polite"></aside>
  </div>
</div>`;
  return layout({
    title: map.name,
    body,
    user,
    bare: true,
    // Classic script for the data, then the deferred module: a module's
    // static imports run before its own body, so data assigned inside the
    // module would arrive after the code that reads it.
    scripts: `<script>window.SALIENT_GAME = ${jsonScript(boot)};</script>
<script type="module" src="/static/build/game.js"></script>`,
  });
}
