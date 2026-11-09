// The maps list and the editor page. The editor's canvas and live behaviour
// are src/client/editor.ts; this is the shell and the tool palette.
import type { User } from "../db/schema.js";
import { MAP_LIMITS } from "../game/mapcheck.js";
import { MAPS } from "../game/maps.js";
import { SEAT_NAMES } from "../game/seats.js";
import type { MapEntry } from "../saved-maps.js";
import { mapThumbnail } from "./components.js";
import { icons } from "./icons.js";
import { NO_AUTOFILL, esc, jsonScript, layout, pageHead, type Html } from "./layout.js";

function newMapForm(entries: MapEntry[]): Html {
  const options = [
    `<option value="blank">A blank field</option>`,
    `<optgroup label="Built-in maps">${MAPS.map((m) => `<option value="${esc(m.id)}">A copy of ${esc(m.name)}</option>`).join("")}</optgroup>`,
    entries.length ? `<optgroup label="Your maps">${entries.map((e) => `<option value="${esc(e.row.id)}">A copy of ${esc(e.row.name)}</option>`).join("")}</optgroup>` : "",
  ].join("");
  return `<form class="card" method="post" action="/maps" id="new-map">
  <div class="card-head"><h2>New map</h2></div>
  <div class="card-body stack">
    <label class="field"><span>Start from</span><select class="select" name="from">${options}</select></label>
    <button class="btn btn-primary btn-lg" type="submit">${icons.plus}<span>Create map</span></button>
    <p class="faint small">Maps save as you go. Each game keeps its own copy of the map it started on, so editing a map never changes a game already under way.</p>
  </div>
</form>`;
}

function mapCard(e: MapEntry): Html {
  const ok = e.problems.length === 0;
  return `<article class="card map-card">
  <a class="map-card-thumb" href="/maps/${esc(e.row.id)}" tabindex="-1">${mapThumbnail(e.map, false)}</a>
  <div class="map-card-body">
    <div class="game-card-title"><h3>${esc(e.row.name)}</h3>${ok ? `<span class="pill pill-ok">Playable</span>` : `<span class="pill pill-warn">${e.problems.length} to fix</span>`}</div>
    <p class="faint small">${e.map.width}×${e.map.height} · ${e.map.seats} players · ${e.map.posts.length} post${e.map.posts.length === 1 ? "" : "s"}</p>
    <div class="btn-row">
      <a class="btn btn-sm" href="/maps/${esc(e.row.id)}">Edit</a>
      ${ok ? `<form method="post" action="/maps/${esc(e.row.id)}/play"><button class="btn btn-sm btn-primary" type="submit">${icons.cpu}<span>Play vs computer</span></button></form>` : ""}
    </div>
  </div>
</article>`;
}

export function mapsPage(user: User, entries: MapEntry[], error?: string): Html {
  const body = `${pageHead({ title: "Your maps", sub: "Design battlefields, then play them against the computer or your friends." })}
${error === "unplayable" ? `<p class="alert alert-danger" role="alert">That map isn't playable yet. Open it to see what needs fixing.</p>` : ""}
<div class="lobby">
  <section class="lobby-main stack">
    ${
      entries.length
        ? `<div class="map-grid">${entries.map(mapCard).join("")}</div>`
        : `<div class="card empty"><div class="empty-icon">${icons.map}</div><h3>No maps yet</h3><p>Start from a blank field or copy one of the built-in maps, then paint terrain, walls and bases.</p></div>`
    }
  </section>
  <aside class="lobby-side">${newMapForm(entries)}</aside>
</div>`;
  return layout({ title: "Maps", body, user, active: "maps" });
}

const TERRAIN_TOOLS: [string, string][] = [
  ["grass", "Grass"],
  ["road", "Road"],
  ["floor", "Floor"],
  ["forest", "Woods"],
  ["rock", "Rock"],
  ["water", "Water"],
  ["crate", "Crates"],
];

const tool = (id: string, label: string, swatch: string, hint: string) =>
  `<button type="button" class="tool" data-tool="${id}" aria-pressed="false" title="${esc(hint)}"><span class="swatch ${swatch}"></span><span>${esc(label)}</span></button>`;

export function editorPage(user: User, entry: MapEntry): Html {
  const m = entry.map;
  const seatChoices = SEAT_NAMES.map(
    (name, i) => `<button type="button" class="seat-pick" data-seat="${i}" style="--seat:var(--seat-${i})" aria-pressed="${i === 0}" aria-label="${esc(name)} base"><span class="seat-dot"></span>${i + 1}</button>`,
  ).join("");
  const body = `<div class="battle editor" id="editor">
  <header class="battle-bar">
    <a class="btn btn-ghost btn-icon" href="/maps" aria-label="Back to your maps">${icons.back}</a>
    <div class="battle-title"><strong id="title">${esc(m.name)}</strong><span id="save-status">All changes saved</span></div>
    <div class="editor-actions">
      <button class="btn btn-icon" type="button" id="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${icons.undo}</button>
      <button class="btn btn-icon" type="button" id="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${icons.redo}</button>
      <form method="post" action="/maps/${esc(entry.row.id)}/play" id="play-form"><button class="btn btn-primary" type="submit" id="play">${icons.cpu}<span>Play it</span></button></form>
    </div>
  </header>
  <div class="battle-main">
    <div class="board-wrap" id="board-wrap">
      <canvas id="board" aria-label="Map canvas"></canvas>
      <div class="board-tooltip" id="tooltip" hidden></div>
      <div class="zoom-controls">
        <button class="btn btn-icon" id="zoom-in" type="button" aria-label="Zoom in">+</button>
        <button class="btn btn-icon" id="zoom-out" type="button" aria-label="Zoom out">−</button>
        <button class="btn btn-icon" id="zoom-fit" type="button" aria-label="Fit map to screen">${icons.target}</button>
      </div>
    </div>
    <aside class="panel editor-panel">
      <section class="panel-section">
        <h3 class="panel-h">Ground</h3>
        <div class="tools">${TERRAIN_TOOLS.map(([id, label]) => tool(id, label, `sw-${id}`, `Paint ${label.toLowerCase()}`)).join("")}</div>
        <div class="segmented compact" role="group" aria-label="Brush">
          <label><input type="radio" name="brush" value="paint" checked><span>Brush</span></label>
          <label><input type="radio" name="brush" value="rect"><span>Rectangle</span></label>
        </div>
      </section>
      <section class="panel-section">
        <h3 class="panel-h">Structures</h3>
        <div class="tools">
          ${tool("building", "Building", "sw-building", "Drag a rectangle: floor inside, walls round it")}
          ${tool("wall", "Wall", "sw-wall", "Blocks movement and sight. Drag along tile edges")}
          ${tool("window", "Window", "sw-window", "Blocks movement; you can see and shoot through it. Outdoors it is a low wall")}
          ${tool("door", "Doorway", "sw-door", "An opening in a wall")}
          ${tool("clear-edge", "Clear edge", "sw-clear", "Remove walls, windows and doorways")}
        </div>
      </section>
      <section class="panel-section">
        <h3 class="panel-h">Sites</h3>
        <div class="tools">
          ${tool("base", "Base", "sw-base", "Where a seat deploys. Pick the seat below")}
          ${tool("post", "Command post", "sw-post", "Captured posts become forward spawn points")}
          ${tool("income", "Income site", "sw-income", "+25 gold a round to whoever holds it. Engineers capture these")}
          ${tool("clear-site", "Clear site", "sw-clear", "Remove bases, posts and income sites")}
        </div>
        <div class="seat-picks" id="seat-picks" role="group" aria-label="Base belongs to">${seatChoices}</div>
      </section>
      <section class="panel-section">
        <h3 class="panel-h">Symmetry</h3>
        <div class="segmented compact three" role="group" aria-label="Symmetry">
          <label><input type="radio" name="symmetry" value="none"><span>Off</span></label>
          <label><input type="radio" name="symmetry" value="mirror" checked><span>Mirror</span></label>
          <label><input type="radio" name="symmetry" value="fourway"><span>Four-way</span></label>
        </div>
        <p class="faint small" id="symmetry-hint">Everything you paint is repeated on the opposite side, and bases go to the other seat, so the map stays fair.</p>
      </section>
      <section class="panel-section" id="problems" aria-live="polite"></section>
      <section class="panel-section">
        <h3 class="panel-h">Map</h3>
        <label class="field"><span>Name</span><input class="input" id="map-name" maxlength="40" value="${esc(m.name)}" ${NO_AUTOFILL}></label>
        <label class="field"><span>Description</span><input class="input" id="map-blurb" maxlength="160" value="${esc(m.blurb)}" ${NO_AUTOFILL}></label>
        <div class="field-row">
          <label class="field"><span>Width</span><input class="input" id="map-width" type="number" inputmode="numeric" min="${MAP_LIMITS.minSize}" max="${MAP_LIMITS.maxSize}" value="${m.width}"></label>
          <label class="field"><span>Height</span><input class="input" id="map-height" type="number" inputmode="numeric" min="${MAP_LIMITS.minSize}" max="${MAP_LIMITS.maxSize}" value="${m.height}"></label>
          <label class="field"><span>Players</span><select class="select" id="map-seats">${[2, 3, 4].map((n) => `<option value="${n}"${n === m.seats ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        </div>
        <p class="faint small">Resizing keeps the top-left corner and trims anything off the edge.</p>
      </section>
      <section class="panel-section panel-foot">
        <details class="danger-zone"><summary class="btn btn-ghost btn-sm">Delete this map</summary>
          <form method="post" action="/maps/${esc(entry.row.id)}/delete" class="confirm-row"><p class="small">Games already played on it keep their own copy.</p><button class="btn btn-danger btn-sm" type="submit">Yes, delete it</button></form>
        </details>
      </section>
    </aside>
  </div>
</div>`;
  return layout({
    title: `Editing ${m.name}`,
    body,
    user,
    bare: true,
    // Classic script for the data, then the deferred module (see game-view.ts).
    scripts: `<script>window.SALIENT_EDITOR = ${jsonScript({ mapId: entry.row.id, map: m })};</script>
<script type="module" src="/static/build/editor.js"></script>`,
  });
}
