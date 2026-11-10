// Shared fragments: map thumbnails, player chips, unit cards.
import { MAPS } from "../game/maps.js";
import { UNITS, UNIT_KINDS, TRAIT_TEXT } from "../game/units.js";
import { unitBadgeSvg } from "../game/glyphs.js";
import { seatName, seatVar } from "../game/seats.js";
import type { MapDef, Terrain } from "../game/types.js";
import type { PlayerInfo } from "../games.js";
import { esc, type Html } from "./layout.js";

/** Terrain colours come from the stylesheet, so thumbnails follow the theme. */
const TERRAIN_FILL: Record<Terrain, string> = {
  grass: "var(--t-grass)",
  road: "var(--t-road)",
  floor: "var(--t-floor)",
  forest: "var(--t-forest)",
  rock: "var(--t-rock)",
  water: "var(--t-water)",
  crate: "var(--t-crate)",
};

/**
 * A small SVG picture of a map. Runs of the same terrain along a row are
 * merged into one rect, which keeps a 25x25 map to a few hundred elements.
 */
export function mapThumbnail(map: MapDef, label = true): Html {
  const parts: string[] = [];
  for (let y = 0; y < map.height; y++) {
    let x = 0;
    while (x < map.width) {
      const t = map.terrain[y * map.width + x]!;
      let run = 1;
      while (x + run < map.width && map.terrain[y * map.width + x + run] === t) run++;
      parts.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${TERRAIN_FILL[t]}"/>`);
      x += run;
    }
  }
  map.bases.forEach((tiles, seat) => {
    for (const p of tiles) parts.push(`<rect x="${p.x + 0.12}" y="${p.y + 0.12}" width="0.76" height="0.76" rx="0.15" fill="${seatVar(seat)}" opacity="0.85"/>`);
  });
  const walls: string[] = [];
  const windows: string[] = [];
  for (let y = 0; y <= map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const e = map.hEdges[y * map.width + x];
      if (e === "wall") walls.push(`M${x} ${y}h1`);
      if (e === "window") windows.push(`M${x} ${y}h1`);
    }
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x <= map.width; x++) {
      const e = map.vEdges[y * (map.width + 1) + x];
      if (e === "wall") walls.push(`M${x} ${y}v1`);
      if (e === "window") windows.push(`M${x} ${y}v1`);
    }
  if (windows.length) parts.push(`<path d="${windows.join("")}" stroke="var(--t-window)" stroke-width="0.22" fill="none"/>`);
  if (walls.length) parts.push(`<path d="${walls.join("")}" stroke="var(--t-wall)" stroke-width="0.32" stroke-linecap="square" fill="none"/>`);
  for (const p of map.posts) parts.push(`<circle cx="${p.x + 0.5}" cy="${p.y + 0.5}" r="0.55" fill="var(--site-post)" stroke="var(--surface)" stroke-width="0.18"/>`);
  for (const p of map.income) parts.push(`<rect x="${p.x + 0.1}" y="${p.y + 0.1}" width="0.8" height="0.8" rx="0.2" transform="rotate(45 ${p.x + 0.5} ${p.y + 0.5})" fill="var(--site-income)" stroke="var(--surface)" stroke-width="0.15"/>`);
  return `<svg class="map-thumb" viewBox="0 0 ${map.width} ${map.height}" ${label ? `role="img" aria-label="${esc(map.name)} map"` : 'aria-hidden="true"'} preserveAspectRatio="xMidYMid meet">${parts.join("")}</svg>`;
}

export function seatChip(seat: number, name: string, extra = ""): Html {
  return `<span class="seat-chip" style="--seat:${seatVar(seat)}"><span class="seat-dot"></span><span class="seat-chip-name">${esc(name)}</span>${extra}</span>`;
}

export function playerList(players: PlayerInfo[], seatCount: number): Html {
  const rows: string[] = [];
  for (let seat = 0; seat < seatCount; seat++) {
    const p = players.find((x) => x.seat === seat);
    rows.push(
      p
        ? `<li>${seatChip(seat, p.name)}<span class="faint">${esc(seatName(seat))}</span></li>`
        : `<li class="empty-seat"><span class="seat-chip" style="--seat:${seatVar(seat)}"><span class="seat-dot hollow"></span><span class="seat-chip-name">Open seat</span></span><span class="faint">${esc(seatName(seat))}</span></li>`,
    );
  }
  return `<ul class="player-list">${rows.join("")}</ul>`;
}

export function unitCards(): Html {
  return `<div class="unit-grid">${UNIT_KINDS.map((k) => {
    const u = UNITS[k];
    const stat = (label: string, value: string | number) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    return `<article class="unit-card">
  <header><span class="unit-badge">${unitBadgeSvg(k)}</span><div><h3>${esc(u.name)}</h3><p class="faint">${esc(u.role)}</p></div><span class="cost">${u.cost}<small>g</small></span></header>
  <dl class="stats">${stat("Health", u.hp)}${stat("Move", u.move)}${stat("Sight", u.sight)}${
    u.traits.includes("unarmed")
      ? stat("Weapon", "None")
      : `${stat("Range", u.range)}${stat("Aim", `${u.accuracy}%`)}${stat("Damage", u.damage)}${stat("Arc", `${u.arc}°`)}${u.shots > 1 ? stat("Shots", u.shots) : ""}`
  }</dl>
  ${u.traits.length ? `<ul class="traits">${u.traits.map((t) => `<li>${esc(TRAIT_TEXT[t])}</li>`).join("")}</ul>` : ""}
</article>`;
  }).join("")}</div>`;
}

export const mapById = (id: string) => MAPS.find((m) => m.id === id);
