// The side panel (a bottom sheet on a phone) and the top bar: plain HTML,
// re-rendered whenever the state or selection changes. Buttons carry a
// data-action that game.ts handles in one delegated listener.
import { BLOCK_TEXT, previewShot, type ShotPreview } from "../game/combat.js";
import { FACING_NAME } from "../game/grid.js";
import { UNIT_GLYPH } from "../game/glyphs.js";
import { seatName } from "../game/seats.js";
import { TRAIT_TEXT, UNITS, UNIT_KINDS } from "../game/units.js";
import type { Facing, Unit, UnitKind } from "../game/types.js";
import {
  canPlan,
  draftProblem,
  goldLeft,
  isMine,
  isMyAttackTurn,
  moveOrderFor,
  mySeat,
  targetsOf,
  baseWarning,
  unitById,
  type ClientState,
} from "./state.js";
import { baseTiles } from "../game/visibility.js";
import type { SeatPublic } from "../game/view.js";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const glyph = (kind: UnitKind) =>
  `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${UNIT_GLYPH[kind]}"/></svg>`;

const seatStyle = (seat: number) => `style="--seat:var(--seat-${seat})"`;

export const playerName = (s: ClientState, seat: number) => s.players.find((p) => p.seat === seat)?.name ?? seatName(seat);

export function unitLabel(s: ClientState, u: Pick<Unit, "seat" | "kind">) {
  return `${isMine(s, u as Unit) ? "Your" : `${esc(playerName(s, u.seat))}'s`} ${esc(UNITS[u.kind].name.toLowerCase())}`;
}

export function renderTopBar(s: ClientState) {
  const v = s.view;
  const phaseLabel = document.getElementById("phase-label")!;
  const board = document.getElementById("scoreboard")!;
  const gold = document.getElementById("gold")!;
  if (!v) {
    phaseLabel.textContent = s.connected ? "Loading…" : "Connecting…";
    return;
  }
  phaseLabel.textContent =
    v.phase === "over" ? "Game over" : `Round ${v.round} · ${v.phase === "planning" ? "Planning" : "Attacks"}`;
  board.innerHTML = v.seats
    .map((p) => {
      const turn = v.phase === "attack" && v.attackTurn === p.seat;
      const status = p.eliminated ? "Out" : v.phase === "planning" ? (p.ready ? "Ready" : "Planning") : turn ? "Firing" : "";
      return `<div class="score${p.seat === v.seat ? " you" : ""}${p.eliminated ? " out" : ""}${turn ? " turn" : ""}" ${seatStyle(p.seat)} title="${esc(playerName(s, p.seat))}">
  <span class="seat-dot"></span><span class="score-name">${esc(playerName(s, p.seat))}</span>
  ${baseChip(s, p)}
  ${status ? `<span class="score-status">${status}</span>` : ""}
</div>`;
    })
    .join("");
  if (v.seat !== null && v.phase !== "over") {
    gold.hidden = false;
    const left = canPlan(s) ? goldLeft(s) : v.gold;
    gold.innerHTML = `<span class="coin"></span><strong>${left}</strong><span class="faint">gold</span>`;
  } else gold.hidden = true;
}

/**
 * A seat's hold on the game: base tiles owned out of its starting base, and
 * units on the field. Out of base tiles and units means out of the game, so
 * the last base tile shows as a warning.
 */
function baseChip(s: ClientState, p: SeatPublic): string {
  const v = s.view!;
  const home = baseTiles(s.map, v.seats.length).filter((t) => t.home === p.seat).length;
  const warn = !p.eliminated && baseWarning(p.baseTiles);
  const label = `${p.baseTiles} of ${home} base tiles, ${p.units} unit${p.units === 1 ? "" : "s"}`;
  return `<span class="base-chip${warn ? " low" : ""}" title="${label}" aria-label="${label}">Base ${p.baseTiles}/${home}<span class="faint"> · ${p.units}u</span></span>`;
}

export function renderPanel(s: ClientState): string {
  const v = s.view;
  if (!v) return `<div class="panel-section"><p class="faint">${s.connected ? "Loading the battle…" : "Connecting to the game…"}</p></div>`;
  const seat = mySeat(s);
  const parts: string[] = [];

  parts.push(statusBlock(s));
  if (v.phase === "planning" && seat !== null) parts.push(planningBlock(s));
  if (v.phase === "attack" && seat !== null) parts.push(attackBlock(s));
  if (v.phase !== "planning" || seat === null) {
    const sel = s.selected;
    if (sel?.type === "unit") {
      const u = unitById(s, sel.id);
      if (u && (!isMine(s, u) || v.phase === "over")) parts.push(unitDetail(s, u));
    }
  }
  parts.push(logBlock(s));
  if (seat !== null && v.phase !== "over" && !v.seats[seat]?.eliminated) {
    parts.push(`<div class="panel-section panel-foot"><button class="btn btn-ghost btn-sm" data-action="resign-ask" type="button">Resign</button></div>`);
  }
  return parts.join("");
}

function statusBlock(s: ClientState): string {
  const v = s.view!;
  const seat = mySeat(s);
  let title = "";
  let sub = "";
  if (v.phase === "over") {
    title = v.winner === null ? "Draw" : v.winner === seat ? "Victory" : `${esc(playerName(s, v.winner))} wins`;
    sub = v.winner === seat ? "The field is yours." : "The fog has lifted. Look around the whole map.";
    return `<div class="panel-section status status-over"><h2>${title}</h2><p>${sub}</p><a class="btn btn-primary" href="/">Back to your games</a></div>`;
  }
  if (seat !== null && v.seats[seat]?.eliminated) {
    return `<div class="panel-section status"><h2>You're out</h2><p>You lost your last base tile and your last unit. You can keep watching your own side's view.</p></div>`;
  }
  if (v.phase === "planning") {
    const waiting = v.seats.filter((p) => !p.eliminated && !p.ready && p.seat !== seat).map((p) => esc(playerName(s, p.seat)));
    if (s.editing) {
      title = "Plan your moves";
      sub = "Tap a unit to move it, or a highlighted base tile to deploy. Everyone moves at once when all orders are in.";
    } else {
      title = "Orders locked in";
      sub = waiting.length ? `Waiting for ${waiting.join(", ")}.` : "Resolving…";
    }
  } else {
    if (isMyAttackTurn(s)) {
      title = "Your shot";
      sub = "Pick a glowing unit, then a target. One unit fires per turn.";
    } else {
      title = v.attackTurn === null ? "Attacks" : `${esc(playerName(s, v.attackTurn))} is firing`;
      sub = "You'll get your turn when they've fired.";
    }
  }
  return `<div class="panel-section status"><h2>${title}</h2><p>${sub}</p></div>`;
}

function planningBlock(s: ClientState): string {
  const v = s.view!;
  const sel = s.selected;
  const parts: string[] = [];
  if (!s.editing) {
    parts.push(`<div class="panel-section"><button class="btn block" data-action="edit-orders" type="button">Change orders</button></div>`);
    return parts.join("");
  }

  if (sel?.type === "unit") {
    const u = unitById(s, sel.id);
    if (u && isMine(s, u)) {
      const order = moveOrderFor(s, u.id);
      const facing = order?.facing ?? u.facing;
      const what = order?.path.length ? `Moving ${order.path.length} step${order.path.length === 1 ? "" : "s"}` : order ? "Turning on the spot" : "Holding position";
      parts.push(`<div class="panel-section unit-sheet" ${seatStyle(u.seat)}>
  ${unitHeader(s, u)}
  <p class="order-line">${what}, facing ${FACING_NAME[facing]}.</p>
  <div class="facing-row"><span class="faint small">Face</span>${compass("set-facing", facing)}</div>
  <p class="faint small">Tap a highlighted tile to move there. Tap the unit again to deselect.</p>
  ${order ? `<button class="btn btn-ghost btn-sm" data-action="clear-order" data-unit="${u.id}" type="button">Clear order</button>` : ""}
</div>`);
    }
  } else if (sel?.type === "spawnTile") {
    const left = goldLeft(s);
    parts.push(`<div class="panel-section"><h3 class="panel-h">Deploy a unit</h3><div class="shop">${UNIT_KINDS.map((k) => {
      const u = UNITS[k];
      const can = u.cost <= left;
      return `<button class="shop-item" type="button" data-action="buy" data-kind="${k}"${can ? "" : " disabled"} title="${esc(u.role)}">
  <span class="unit-badge" ${seatStyle(v.seat!)}>${glyph(k)}</span><span class="shop-name">${esc(u.name)}</span><span class="shop-cost">${u.cost}g</span>
</button>`;
    }).join("")}</div><p class="faint small">${left} gold left this round.</p></div>`);
  } else if (sel?.type === "spawn") {
    const sp = s.draft.spawns[sel.index];
    if (sp) {
      parts.push(`<div class="panel-section unit-sheet" ${seatStyle(v.seat!)}>
  <div class="unit-head"><span class="unit-badge">${glyph(sp.kind)}</span><div><h3>${esc(UNITS[sp.kind].name)}</h3><p class="faint small">Deploying · ${UNITS[sp.kind].cost} gold</p></div></div>
  <p class="faint small">${esc(UNITS[sp.kind].role)}</p>
  <div class="facing-row"><span class="faint small">Face</span>${compass("spawn-facing", sp.facing)}</div>
  <button class="btn btn-ghost btn-sm" data-action="cancel-spawn" type="button">Cancel deployment</button>
</div>`);
    }
  } else {
    const units = v.units.filter((u) => isMine(s, u));
    const ordered = s.draft.moves.filter((m) => m.path.length > 0).length;
    parts.push(`<div class="panel-section"><p class="faint small">${units.length ? `${units.length} unit${units.length === 1 ? "" : "s"} on the field · ${ordered} moving · ${s.draft.spawns.length} deploying` : `No units yet. Tap a dashed tile on your base to deploy.`}</p></div>`);
  }

  const problem = draftProblem(s);
  parts.push(`<div class="panel-section panel-action">
  ${problem ? `<p class="alert alert-danger small">${esc(problem)}</p>` : ""}
  <button class="btn btn-primary btn-lg block" data-action="submit" type="button"${problem || s.pending ? " disabled" : ""}>Lock in orders</button>
</div>`);
  return parts.join("");
}

function attackBlock(s: ClientState): string {
  const v = s.view!;
  const sel = s.selected;
  if (!isMyAttackTurn(s)) {
    if (sel?.type === "unit") {
      const u = unitById(s, sel.id);
      if (u && isMine(s, u)) return unitDetail(s, u);
    }
    return "";
  }
  const parts: string[] = [];
  const shooterId = sel?.type === "unit" ? sel.id : sel?.type === "target" ? sel.shooterId : null;
  const shooter = shooterId !== null ? unitById(s, shooterId) : undefined;
  if (shooter && isMine(s, shooter)) {
    const acted = v.acted.includes(shooter.id);
    const targets = acted ? [] : targetsOf(s, shooter);
    const target = sel?.type === "target" ? unitById(s, sel.targetId) : undefined;
    parts.push(`<div class="panel-section unit-sheet" ${seatStyle(shooter.seat)}>${unitHeader(s, shooter)}`);
    if (acted) parts.push(`<p class="faint small">Already acted this round.</p>`);
    else if (target) {
      const p = previewShot(s.map, shooter, target);
      parts.push(shotBreakdown(s, target, p));
      parts.push(`<div class="btn-row"><button class="btn btn-danger btn-lg grow" data-action="fire" type="button"${s.pending ? " disabled" : ""}>Fire · ${Math.round(p.chance * 100)}%</button><button class="btn" data-action="untarget" type="button">Back</button></div>`);
    } else if (targets.length) {
      parts.push(`<h3 class="panel-h">Targets</h3><ul class="target-list">${targets
        .map((t) => {
          const p = previewShot(s.map, shooter, t);
          return `<li><button class="target-item" type="button" data-action="target" data-target="${t.id}" ${seatStyle(t.seat)}><span class="unit-badge sm">${glyph(t.kind)}</span><span>${unitLabel(s, t)}<small class="faint">${t.hp} hp · ${p.flank}${p.inCover ? " · in cover" : ""}</small></span><strong>${Math.round(p.chance * 100)}%</strong></button></li>`;
        })
        .join("")}</ul>`);
    } else parts.push(`<p class="faint small">Nothing this unit can hit from here.</p>`);
    if (!acted) parts.push(`<button class="btn btn-ghost btn-sm" data-action="hold" data-unit="${shooter.id}" type="button">Hold fire with this unit</button>`);
    parts.push(`</div>`);
  } else {
    const ready = v.readyShooters.map((id) => unitById(s, id)).filter((u): u is Unit => !!u);
    parts.push(`<div class="panel-section"><h3 class="panel-h">Ready to fire</h3><ul class="target-list">${ready
      .map((u) => `<li><button class="target-item" type="button" data-action="select-unit" data-unit="${u.id}" ${seatStyle(u.seat)}><span class="unit-badge sm">${glyph(u.kind)}</span><span>${esc(UNITS[u.kind].name)}<small class="faint">${targetsOf(s, u).length} target${targetsOf(s, u).length === 1 ? "" : "s"}</small></span></button></li>`)
      .join("")}</ul></div>`);
  }
  parts.push(`<div class="panel-section panel-action"><button class="btn block" data-action="end-attacks" type="button"${s.pending ? " disabled" : ""}>Done firing this round</button></div>`);
  return parts.join("");
}

function shotBreakdown(s: ClientState, target: Unit, p: ShotPreview): string {
  if (!p.possible) return `<p class="alert alert-danger small">${BLOCK_TEXT[p.block!]}</p>`;
  const rows = p.modifiers
    .map((m) => `<li><span>${esc(m.label)}</span><span>${m.factor === 1 ? "—" : `×${m.factor.toFixed(2)}`}</span></li>`)
    .join("");
  return `<div class="shot" ${seatStyle(target.seat)}>
  <div class="shot-head"><span class="unit-badge sm">${glyph(target.kind)}</span><span>${unitLabel(s, target)}<small class="faint">${target.hp} / ${UNITS[target.kind].hp} hp</small></span></div>
  <dl class="shot-stats"><div><dt>Hit chance</dt><dd>${Math.round(p.chance * 100)}%</dd></div><div><dt>Damage</dt><dd>${p.damage}</dd></div><div><dt>Angle</dt><dd>${p.flank}</dd></div></dl>
  ${rows ? `<ul class="mods">${rows}</ul>` : `<p class="faint small">Clean shot: no modifiers.</p>`}
</div>`;
}

function unitHeader(s: ClientState, u: Unit): string {
  const st = UNITS[u.kind];
  const f = u.hp / st.hp;
  return `<div class="unit-head"><span class="unit-badge">${glyph(u.kind)}</span><div class="grow"><h3>${esc(st.name)}</h3>
  <div class="hp-bar" role="img" aria-label="${u.hp} of ${st.hp} health"><span style="width:${Math.round(f * 100)}%" class="${f > 0.6 ? "ok" : f > 0.3 ? "warn" : "danger"}"></span></div>
  <p class="faint small">${u.hp}/${st.hp} hp · move ${st.move} · range ${st.range} · aim ${st.accuracy}%</p></div></div>`;
}

function unitDetail(s: ClientState, u: Unit): string {
  const st = UNITS[u.kind];
  return `<div class="panel-section unit-sheet" ${seatStyle(u.seat)}>${unitHeader(s, u)}
  <p class="faint small">${unitLabel(s, u)}. ${esc(st.role)}</p>
  ${st.traits.length ? `<ul class="traits">${st.traits.map((t) => `<li>${esc(TRAIT_TEXT[t])}</li>`).join("")}</ul>` : ""}
</div>`;
}

function compass(action: string, current: Facing): string {
  // 3x3 grid, centre empty; cells in facing order around it.
  const cells: (Facing | null)[] = [7, 0, 1, 6, null, 2, 5, 4, 3];
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return `<div class="compass" role="group" aria-label="Facing">${cells
    .map((f) =>
      f === null
        ? `<span></span>`
        : `<button type="button" data-action="${action}" data-facing="${f}" aria-pressed="${f === current}" aria-label="Face ${FACING_NAME[f]}">${arrows[f]}</button>`,
    )
    .join("")}</div>`;
}

function logBlock(s: ClientState): string {
  if (!s.log.length) return "";
  const lines = s.log.slice(-14).reverse();
  return `<details class="panel-section log" open><summary>Battle log</summary><ol>${lines.map((l) => `<li><span class="faint">R${l.round}</span> ${l.html}</li>`).join("")}</ol></details>`;
}

export function resignConfirm(): string {
  return `<div class="panel-section panel-foot confirm"><p class="small">Resign this game? Your units leave the field and you can't come back.</p><div class="btn-row"><button class="btn btn-danger btn-sm" data-action="resign" type="button">Yes, resign</button><button class="btn btn-sm" data-action="resign-cancel" type="button">Keep playing</button></div></div>`;
}
