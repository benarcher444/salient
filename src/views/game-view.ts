// The battle page: a canvas and a side panel, both driven by public/build/game.js.
import type { User } from "../db/schema.js";
import type { LiveGame } from "../games.js";
import { keyHelpHtml } from "../game/keys.js";
import { icons } from "./icons.js";
import { esc, jsonScript, layout, type Html } from "./layout.js";

export function battlePage(user: User, live: LiveGame, seat: number | null): Html {
  const map = live.map;
  const boot = {
    gameId: live.game.id,
    mapId: map.id,
    // The game's own map snapshot: custom maps are not in the browser bundle.
    map,
    // And its own tuning (unit stats, rule numbers): the browser previews
    // shots with the numbers the server will roll with.
    tuning: live.tuning,
    seat,
    players: live.players.map((p) => ({ seat: p.seat, name: p.name })),
  };
  const body = `<div class="battle" id="battle">
  <header class="battle-bar">
    ${user.isGuest ? "" : `<a class="btn btn-ghost btn-icon" href="/" aria-label="Back to your games">${icons.back}</a>`}
    <div class="battle-title"><strong>${esc(map.name)}</strong><span id="phase-label">Connecting…</span></div>
    <div class="scoreboard" id="scoreboard" aria-label="Sides"></div>
    <div class="gold-pill" id="gold" hidden></div>
  </header>
  <div class="battle-main">
    <div class="board-wrap" id="board-wrap">
      <canvas id="board" aria-label="Battle map"></canvas>
      <div class="board-tooltip" id="tooltip" hidden></div>
      <div class="board-banner" id="banner" hidden></div>
      <div class="key-help" id="key-help" role="dialog" aria-label="Keyboard controls" hidden>
        <div class="key-help-head"><h2>Keyboard</h2><button class="btn btn-ghost btn-sm" id="key-help-close" type="button">Close</button></div>
        ${keyHelpHtml()}
      </div>
      <div class="zoom-controls">
        <button class="btn btn-icon keys-only" id="key-help-open" type="button" aria-label="Keyboard controls" title="Keyboard controls (?)">?</button>
        <button class="btn btn-icon" id="zoom-in" type="button" aria-label="Zoom in">+</button>
        <button class="btn btn-icon" id="zoom-out" type="button" aria-label="Zoom out">−</button>
        <button class="btn btn-icon" id="zoom-fit" type="button" aria-label="Fit map to screen">${icons.target}</button>
      </div>
    </div>
    <aside class="side">
      <div class="panel" id="panel" aria-live="polite"></div>
      <div class="minimap-wrap">
        <canvas id="minimap" aria-label="Minimap: click or drag to move the view"></canvas>
      </div>
    </aside>
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
