// The map editor: paint ground, structures and sites onto a map, repeated
// through the chosen symmetry, with undo, live problem-checking and autosave.
// Every edit goes through the small set of primitives below (setTerrain,
// setEdge, placeSite), each applied once per symmetry image.
import { TERRAIN } from "../game/grid.js";
import { MAP_LIMITS, checkMap } from "../game/mapcheck.js";
import { symmetryTransforms, type SymmetryMode, type Transform } from "../game/maps.js";
import { seatName } from "../game/seats.js";
import type { EdgeKind, MapDef, Point, Side, Terrain } from "../game/types.js";
import { renderMapArt } from "./art.js";
import { Camera } from "./camera.js";
import { alpha, readPalette, type Palette } from "./palette.js";
import { drawIncome, drawPost } from "./sites.js";

declare global {
  interface Window {
    SALIENT_EDITOR: { mapId: string; map: MapDef };
  }
}

type Tool =
  | Terrain
  | "building"
  | "wall"
  | "window"
  | "door"
  | "clear-edge"
  | "base"
  | "post"
  | "income"
  | "clear-site";

const TERRAIN_TOOLS = new Set<string>(["grass", "road", "floor", "forest", "rock", "water", "crate"]);
const EDGE_TOOLS = new Set<string>(["wall", "window", "door", "clear-edge"]);
const RECT_TOOLS = new Set<string>(["building"]);
/** Pixels per tile in the editor's map art: smaller than the battle's, as it redraws on every stroke. */
const EDITOR_ART_PX = 44;
const SAVE_DELAY = 700;
const HISTORY = 100;

const boot = window.SALIENT_EDITOR;
let map: MapDef = { ...structuredClone(boot.map), id: boot.mapId };

let tool: Tool = "grass";
let brush: "paint" | "rect" = "paint";
let seat = 0;
let symmetry: SymmetryMode = "mirror";

// --- Elements -------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("board");
const wrap = $("board-wrap");
const tooltip = $("tooltip");
const problemsEl = $("problems");
const statusEl = $("save-status");
const titleEl = $("title");
const nameInput = $<HTMLInputElement>("map-name");
const blurbInput = $<HTMLInputElement>("map-blurb");
const widthInput = $<HTMLInputElement>("map-width");
const heightInput = $<HTMLInputElement>("map-height");
const seatsInput = $<HTMLSelectElement>("map-seats");
const playButton = $<HTMLButtonElement>("play");
const ctx = canvas.getContext("2d")!;

let camera = new Camera(map.width, map.height);
let pal: Palette = readPalette();
let art: HTMLCanvasElement | null = null;
let artDirty = true;
let viewW = 0;
let viewH = 0;
let userMoved = false;

// --- The edit primitives, applied through symmetry ---------------------------------

function images(): Transform[] {
  return symmetryTransforms(symmetry, map.width, map.height);
}

const inMap = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

function setTerrain(p: Point, t: Terrain) {
  for (const tr of images()) {
    const q = tr.point(p);
    if (inMap(q)) map.terrain[q.y * map.width + q.x] = t;
  }
}

function setEdge(p: Point, side: Side, kind: EdgeKind | null) {
  for (const tr of images()) {
    const q = tr.point(p);
    if (!inMap(q)) continue;
    const s = tr.side(side);
    const w = map.width;
    if (s === "n") map.hEdges[q.y * w + q.x] = kind;
    else if (s === "s") map.hEdges[(q.y + 1) * w + q.x] = kind;
    else if (s === "w") map.vEdges[q.y * (w + 1) + q.x] = kind;
    else map.vEdges[q.y * (w + 1) + q.x + 1] = kind;
  }
}

/** Remove any site (base tile, post, income) from one tile. */
function clearSiteAt(q: Point) {
  map.bases = map.bases.map((tiles) => tiles.filter((t) => !same(t, q)));
  map.posts = map.posts.filter((t) => !same(t, q));
  map.income = map.income.filter((t) => !same(t, q));
}

/**
 * Put a site on a tile and each of its images. Base image k belongs to the
 * seat k places on from the one chosen: the mirror of your base is the
 * other player's base.
 */
function placeSite(p: Point, kind: "base" | "post" | "income" | "clear") {
  images().forEach((tr, k) => {
    const q = tr.point(p);
    if (!inMap(q)) return;
    clearSiteAt(q);
    if (kind === "base") map.bases[(seat + k) % map.seats]!.push(q);
    if (kind === "post") map.posts.push(q);
    if (kind === "income") map.income.push({ ...q, value: 25 });
  });
}

function building(a: Point, b: Point) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      setTerrain({ x, y }, "floor");
      if (y === y0) setEdge({ x, y }, "n", "wall");
      if (y === y1) setEdge({ x, y }, "s", "wall");
      if (x === x0) setEdge({ x, y }, "w", "wall");
      if (x === x1) setEdge({ x, y }, "e", "wall");
    }
  }
}

function fillRect(a: Point, b: Point, t: Terrain) {
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) setTerrain({ x, y }, t);
}

/** Apply the current tool at a tile, or an edge for the edge tools. */
function applyAt(world: { x: number; y: number }) {
  const p = { x: Math.floor(world.x), y: Math.floor(world.y) };
  if (!inMap(p)) return;
  if (TERRAIN_TOOLS.has(tool)) setTerrain(p, tool as Terrain);
  else if (EDGE_TOOLS.has(tool)) {
    const side = nearestSide(world);
    setEdge(p, side, tool === "clear-edge" ? null : (tool as EdgeKind));
  } else if (tool === "base") placeSite(p, "base");
  else if (tool === "post") placeSite(p, "post");
  else if (tool === "income") placeSite(p, "income");
  else if (tool === "clear-site") placeSite(p, "clear");
}

/** Which edge of its tile a point is nearest to. */
function nearestSide(world: { x: number; y: number }): Side {
  const fx = world.x - Math.floor(world.x);
  const fy = world.y - Math.floor(world.y);
  const d: [Side, number][] = [
    ["n", fy],
    ["s", 1 - fy],
    ["w", fx],
    ["e", 1 - fx],
  ];
  return d.sort((a, b) => a[1] - b[1])[0]![0];
}

/** Resize, keeping the top-left corner; anything beyond the new edge is dropped. */
function resize(width: number, height: number) {
  const w = Math.max(MAP_LIMITS.minSize, Math.min(MAP_LIMITS.maxSize, Math.round(width)));
  const h = Math.max(MAP_LIMITS.minSize, Math.min(MAP_LIMITS.maxSize, Math.round(height)));
  if (w === map.width && h === map.height) return;
  const old = map;
  const terrain: Terrain[] = new Array<Terrain>(w * h).fill("grass");
  const hEdges: (EdgeKind | null)[] = new Array(w * (h + 1)).fill(null);
  const vEdges: (EdgeKind | null)[] = new Array((w + 1) * h).fill(null);
  for (let y = 0; y < Math.min(h, old.height); y++) for (let x = 0; x < Math.min(w, old.width); x++) terrain[y * w + x] = old.terrain[y * old.width + x]!;
  for (let y = 0; y <= Math.min(h, old.height); y++) for (let x = 0; x < Math.min(w, old.width); x++) hEdges[y * w + x] = old.hEdges[y * old.width + x] ?? null;
  for (let y = 0; y < Math.min(h, old.height); y++) for (let x = 0; x <= Math.min(w, old.width); x++) vEdges[y * (w + 1) + x] = old.vEdges[y * (old.width + 1) + x] ?? null;
  const keep = <P extends Point>(ps: P[]) => ps.filter((p) => p.x < w && p.y < h);
  map = { ...old, width: w, height: h, terrain, hEdges, vEdges, bases: old.bases.map(keep), posts: keep(old.posts), income: keep(old.income) };
  if (symmetry === "fourway" && w !== h) setSymmetry("mirror");
  camera = new Camera(w, h);
  userMoved = false;
  fit();
}

function setSeats(n: number) {
  if (n === map.seats) return;
  const bases = map.bases.slice(0, n);
  while (bases.length < n) bases.push([]);
  map = { ...map, seats: n, bases };
  seat = Math.min(seat, n - 1);
}

// --- Undo -----------------------------------------------------------------------------

const undoStack: string[] = [];
const redoStack: string[] = [];
let strokeStart: string | null = null;

const snapshot = () => JSON.stringify(map);

function beginStroke() {
  strokeStart = snapshot();
}

/** Close a stroke: if anything changed, it becomes one undo step. */
function endStroke() {
  if (strokeStart === null) return;
  if (strokeStart !== snapshot()) {
    undoStack.push(strokeStart);
    if (undoStack.length > HISTORY) undoStack.shift();
    redoStack.length = 0;
    changed();
  }
  strokeStart = null;
}

function cancelStroke() {
  if (strokeStart !== null) map = JSON.parse(strokeStart) as MapDef;
  strokeStart = null;
  rect = null;
  artDirty = true;
}

function restore(json: string) {
  const before = map;
  map = JSON.parse(json) as MapDef;
  if (before.width !== map.width || before.height !== map.height) {
    camera = new Camera(map.width, map.height);
    userMoved = false;
    fit();
  }
  syncInputs();
  changed();
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(snapshot());
  restore(prev);
}

function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snapshot());
  restore(next);
}

// --- Saving and problems --------------------------------------------------------------

let saveTimer = 0;
let saving = false;
let dirty = false;

function changed() {
  artDirty = true;
  dirty = true;
  renderProblems();
  statusEl.textContent = "Unsaved changes…";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, SAVE_DELAY);
  ($<HTMLButtonElement>("undo")).disabled = undoStack.length === 0;
  ($<HTMLButtonElement>("redo")).disabled = redoStack.length === 0;
}

async function save(): Promise<boolean> {
  if (saving) {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, SAVE_DELAY);
    return false;
  }
  saving = true;
  dirty = false;
  statusEl.textContent = "Saving…";
  const { id: _id, ...body } = map;
  try {
    const res = await fetch(`/maps/${encodeURIComponent(boot.mapId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    statusEl.textContent = dirty ? "Unsaved changes…" : "All changes saved";
    return true;
  } catch {
    dirty = true;
    statusEl.textContent = "Couldn't save. Retrying…";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, 3000);
    return false;
  } finally {
    saving = false;
  }
}

function renderProblems() {
  const problems = checkMap(map);
  playButton.disabled = problems.length > 0;
  playButton.title = problems.length ? "Fix the problems listed in the panel first" : "Play this map against the computer";
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  problemsEl.innerHTML = problems.length
    ? `<h3 class="panel-h">To fix before playing</h3><ul class="problem-list">${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`
    : `<p class="alert alert-ok small">Ready to play. Try it against the computer with <strong>Play it</strong>, or pick it in the new-game form.</p>`;
}

// Leaving with "Play it" first makes sure the latest edit is saved.
$("play-form").addEventListener("submit", async (e) => {
  if (!dirty && !saving) return;
  e.preventDefault();
  window.clearTimeout(saveTimer);
  if (await save()) ($<HTMLFormElement>("play-form")).submit();
});

// --- Drawing --------------------------------------------------------------------------

let hover: { x: number; y: number } | null = null;
let rect: { from: Point; to: Point } | null = null;

function fit() {
  camera.fit(viewW, viewH, 16);
}

function resizeCanvas() {
  const r = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  viewW = r.width;
  viewH = r.height;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  canvas.style.width = `${r.width}px`;
  canvas.style.height = `${r.height}px`;
  if (!userMoved) fit();
}

function draw(now: number) {
  const dpr = window.devicePixelRatio || 1;
  if (artDirty || !art) {
    art = renderMapArt(map, pal, EDITOR_ART_PX);
    artDirty = false;
  }
  camera.clamp(viewW, viewH);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.save();
  ctx.translate(-camera.x * camera.scale, -camera.y * camera.scale);
  ctx.scale(camera.scale, camera.scale);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(art, 0, 0, map.width, map.height);
  map.posts.forEach((p, i) => drawPost(ctx, pal, p, null, now, i));
  map.income.forEach((p, i) => drawIncome(ctx, pal, p, null, now, i));
  drawSymmetryGuide();
  drawCursor();
  ctx.restore();
  requestAnimationFrame(draw);
}

/** Faint lines through the centre showing what the symmetry repeats across. */
function drawSymmetryGuide() {
  if (symmetry === "none") return;
  const cx = map.width / 2;
  const cy = map.height / 2;
  ctx.strokeStyle = alpha(pal.paper, 0.55);
  ctx.lineWidth = 0.05;
  ctx.setLineDash([0.3, 0.25]);
  ctx.beginPath();
  if (symmetry === "fourway") {
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, map.height);
  }
  ctx.moveTo(0, cy);
  ctx.lineTo(map.width, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = alpha(pal.paper, 0.85);
  ctx.beginPath();
  ctx.arc(cx, cy, 0.14, 0, Math.PI * 2);
  ctx.fill();
}

/** Where the tool will act, shown on every symmetry image. */
function drawCursor() {
  const colour = tool === "base" ? pal.seats[seat]! : pal.paper;
  const outline = (p: Point, k: number) => {
    ctx.strokeStyle = tool === "base" ? pal.seats[(seat + k) % map.seats]! : alpha(colour, k === 0 ? 0.95 : 0.55);
    ctx.lineWidth = 0.07;
    ctx.strokeRect(p.x + 0.05, p.y + 0.05, 0.9, 0.9);
  };
  if (rect) {
    const x0 = Math.min(rect.from.x, rect.to.x);
    const y0 = Math.min(rect.from.y, rect.to.y);
    const x1 = Math.max(rect.from.x, rect.to.x);
    const y1 = Math.max(rect.from.y, rect.to.y);
    images().forEach((tr, k) => {
      const a = tr.point({ x: x0, y: y0 });
      const b = tr.point({ x: x1, y: y1 });
      ctx.fillStyle = alpha(pal.paper, k === 0 ? 0.25 : 0.12);
      ctx.strokeStyle = alpha(pal.paper, k === 0 ? 0.95 : 0.55);
      ctx.lineWidth = 0.08;
      const rx = Math.min(a.x, b.x);
      const ry = Math.min(a.y, b.y);
      const rw = Math.abs(a.x - b.x) + 1;
      const rh = Math.abs(a.y - b.y) + 1;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
    });
    return;
  }
  if (!hover) return;
  const p = { x: Math.floor(hover.x), y: Math.floor(hover.y) };
  if (!inMap(p)) return;
  if (EDGE_TOOLS.has(tool)) {
    const side = nearestSide(hover);
    images().forEach((tr, k) => {
      const q = tr.point(p);
      const s = tr.side(side);
      const [x1, y1, x2, y2] =
        s === "n" ? [q.x, q.y, q.x + 1, q.y] : s === "s" ? [q.x, q.y + 1, q.x + 1, q.y + 1] : s === "w" ? [q.x, q.y, q.x, q.y + 1] : [q.x + 1, q.y, q.x + 1, q.y + 1];
      ctx.strokeStyle = alpha(pal.warn, k === 0 ? 1 : 0.6);
      ctx.lineWidth = 0.16;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
    return;
  }
  images().forEach((tr, k) => outline(tr.point(p), k));
}

// --- Pointer input --------------------------------------------------------------------

const pointers = new Map<number, { x: number; y: number }>();
let panning = false;
let painting = false;
let pinchDistance = 0;
let spaceHeld = false;

const local = (e: PointerEvent | WheelEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
const worldAt = (sx: number, sy: number) => camera.toWorld(sx, sy);
const tileOf = (w: { x: number; y: number }): Point => ({ x: Math.floor(w.x), y: Math.floor(w.y) });
const usesRect = () => RECT_TOOLS.has(tool) || (TERRAIN_TOOLS.has(tool) && brush === "rect");

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = local(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    // A second finger: this was a pinch or a pan, not a stroke. Undo whatever
    // the first finger started painting.
    cancelStroke();
    painting = false;
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    return;
  }
  if (e.button === 1 || e.button === 2 || spaceHeld) {
    panning = true;
    return;
  }
  const w = worldAt(p.x, p.y);
  if (!inMap(tileOf(w))) return;
  beginStroke();
  painting = true;
  if (usesRect()) rect = { from: tileOf(w), to: tileOf(w) };
  else applyAt(w);
  artDirty = true;
});

canvas.addEventListener("pointermove", (e) => {
  const p = local(e);
  const prev = pointers.get(e.pointerId);
  const w = worldAt(p.x, p.y);
  hover = w;
  showTooltip(p, w);
  if (!prev) return;
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinchDistance > 0) camera.zoomAt(d / pinchDistance, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
    camera.pan((p.x - prev.x) / 2, (p.y - prev.y) / 2);
    pinchDistance = d;
    userMoved = true;
    return;
  }
  if (panning) {
    camera.pan(p.x - prev.x, p.y - prev.y);
    userMoved = true;
    return;
  }
  if (!painting) return;
  if (rect) {
    const t = tileOf(w);
    if (inMap(t)) rect.to = t;
  } else {
    applyAt(w);
    artDirty = true;
  }
});

function endPointer(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDistance = 0;
  if (pointers.size > 0) return;
  if (painting) {
    if (rect) {
      if (tool === "building") building(rect.from, rect.to);
      else fillRect(rect.from, rect.to, tool as Terrain);
      rect = null;
    }
    painting = false;
    endStroke();
  }
  panning = false;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", (e) => {
  cancelStroke();
  painting = false;
  endPointer(e);
});
canvas.addEventListener("pointerleave", () => {
  if (pointers.size === 0) {
    hover = null;
    tooltip.hidden = true;
  }
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const p = local(e);
    camera.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    userMoved = true;
  },
  { passive: false },
);

function showTooltip(sp: { x: number; y: number }, w: { x: number; y: number }) {
  const t = tileOf(w);
  if (!inMap(t)) {
    tooltip.hidden = true;
    return;
  }
  const ground = TERRAIN[map.terrain[t.y * map.width + t.x]!].label;
  const base = map.bases.findIndex((tiles) => tiles.some((q) => same(q, t)));
  const site = base >= 0 ? `${seatName(base)} base` : map.posts.some((q) => same(q, t)) ? "Command post" : map.income.some((q) => same(q, t)) ? "Supply depot" : "";
  tooltip.innerHTML = `<strong>${t.x + 1}, ${t.y + 1}</strong><span>${ground}${site ? ` · ${site}` : ""}</span>`;
  tooltip.style.left = `${sp.x + 14}px`;
  tooltip.style.top = `${sp.y + 14}px`;
  tooltip.hidden = false;
}

// --- The panel ------------------------------------------------------------------------

function selectTool(next: Tool) {
  tool = next;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === next));
  $("seat-picks").classList.toggle("active", next === "base");
}

function setSymmetry(mode: SymmetryMode) {
  symmetry = mode === "fourway" && map.width !== map.height ? "mirror" : mode;
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="symmetry"]')) r.checked = r.value === symmetry;
  const four = document.querySelector<HTMLInputElement>('input[name="symmetry"][value="fourway"]')!;
  four.disabled = map.width !== map.height;
  four.closest("label")!.title = four.disabled ? "Four-way symmetry needs a square map" : "";
  $("symmetry-hint").textContent =
    symmetry === "none"
      ? "Strokes are painted once, exactly where you put them."
      : symmetry === "mirror"
        ? "Everything you paint is repeated on the opposite side, and bases go to the other seat, so the map stays fair."
        : "Everything you paint is repeated in all four quarters, turned each time, and bases go round the seats.";
}

function syncInputs() {
  nameInput.value = map.name;
  blurbInput.value = map.blurb;
  widthInput.value = String(map.width);
  heightInput.value = String(map.height);
  seatsInput.value = String(map.seats);
  titleEl.textContent = map.name || "Untitled map";
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-seat]")) {
    const n = Number(b.dataset.seat);
    b.hidden = n >= map.seats;
    b.setAttribute("aria-pressed", String(n === seat));
  }
  setSymmetry(symmetry);
}

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.addEventListener("click", () => selectTool(b.dataset.tool as Tool));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-seat]")) {
  b.addEventListener("click", () => {
    seat = Number(b.dataset.seat);
    selectTool("base");
    syncInputs();
  });
}
for (const r of document.querySelectorAll<HTMLInputElement>('input[name="brush"]')) r.addEventListener("change", () => (brush = r.value as "paint" | "rect"));
for (const r of document.querySelectorAll<HTMLInputElement>('input[name="symmetry"]')) r.addEventListener("change", () => setSymmetry(r.value as SymmetryMode));

// Text fields save as you type but are not undo steps: undo is for the canvas.
nameInput.addEventListener("input", () => {
  map.name = nameInput.value.slice(0, 40);
  titleEl.textContent = map.name || "Untitled map";
  changed();
});
blurbInput.addEventListener("input", () => {
  map.blurb = blurbInput.value.slice(0, 160);
  changed();
});
const onSize = () => {
  const w = Number(widthInput.value);
  const h = Number(heightInput.value);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;
  beginStroke();
  resize(w, h);
  endStroke();
  syncInputs();
};
widthInput.addEventListener("change", onSize);
heightInput.addEventListener("change", onSize);
seatsInput.addEventListener("change", () => {
  beginStroke();
  setSeats(Number(seatsInput.value));
  endStroke();
  syncInputs();
});

$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("zoom-in").addEventListener("click", () => {
  camera.zoomAt(1.25, viewW / 2, viewH / 2);
  userMoved = true;
});
$("zoom-out").addEventListener("click", () => {
  camera.zoomAt(0.8, viewW / 2, viewH / 2);
  userMoved = true;
});
$("zoom-fit").addEventListener("click", () => {
  userMoved = false;
  fit();
});

window.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).closest("input, textarea, select");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
    e.preventDefault();
    redo();
  } else if (e.key === "Escape") {
    cancelStroke();
    painting = false;
  } else if (e.key === " " && !typing) {
    spaceHeld = true;
    canvas.style.cursor = "grab";
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    spaceHeld = false;
    canvas.style.cursor = "";
  }
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  pal = readPalette();
  artDirty = true;
});
new ResizeObserver(resizeCanvas).observe(wrap);

// Read-only hooks for the browser suite: where a tile is on screen, and the
// map as it stands. Tests click real coordinates through these.
(window as unknown as { __editor: unknown }).__editor = {
  screenOf: (x: number, y: number, fx = 0.5, fy = 0.5) => {
    const p = camera.toScreen(x + fx, y + fy);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  },
  map: () => map,
  saved: () => !dirty && !saving,
  problems: () => checkMap(map),
};

selectTool("grass");
syncInputs();
renderProblems();
($<HTMLButtonElement>("undo")).disabled = true;
($<HTMLButtonElement>("redo")).disabled = true;
resizeCanvas();
requestAnimationFrame(draw);
