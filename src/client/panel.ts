// The side panel (a bottom sheet on a phone) and the top bar: plain HTML,
// re-rendered whenever the state or selection changes. Buttons carry a
// data-action that game.ts handles in one delegated listener.
import { BLOCK_TEXT, damageRange, isArmed, previewShot, type ShotPreview } from "../game/combat.js";
import { RULES } from "../game/constants.js";
import { FACING_NAME, facingName } from "../game/grid.js";
import { unitBadgeSvg } from "../game/glyphs.js";
import { seatName } from "../game/seats.js";
import { TRAIT_TEXT, UNITS, UNIT_KINDS, hasTrait } from "../game/units.js";
import type { Facing, Unit, UnitKind } from "../game/types.js";
import {
  canPlan,
  draftProblem,
  goldLeft,
  partialState,
  isMine,
  isMyAttackTurn,
  moveOrderFor,
  mySeat,
  routeFor,
  routePlan,
  targetsOf,
  baseWarning,
  unitById,
  type ClientState,
} from "./state.js";
import { baseTiles } from "../game/visibility.js";
import type { SeatPublic } from "../game/view.js";
import { unitUpkeep, upkeepFor } from "../game/rules.js";

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const glyph = (kind: UnitKind) => unitBadgeSvg(kind);

/** A key hint, shown only where there is a keyboard (CSS hides it on touch screens). */
const kbd = (key: string | number) => `<kbd class="key-hint">${key}</kbd>`;

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
  const stage = v.phase === "over" ? "Game over" : `Round ${v.round} · ${v.phase === "planning" ? "Planning" : "Attacks"}`;
  phaseLabel.textContent = s.replay ? `Replay · ${stage}` : stage;
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
    const income = incomePerRound(s);
    const keep = RULES.upkeep ? upkeepFor(partialState(s), v.seat) : 0;
    const net = income - keep;
    const label = `${left} gold; ${net >= 0 ? "+" : "−"}${Math.abs(net)} at the end of every round (${RULES.baseIncome} base${income > RULES.baseIncome ? `, ${income - RULES.baseIncome} from supply depots` : ""}${RULES.upkeep ? `, less ${keep} upkeep` : ""})`;
    gold.title = label;
    gold.setAttribute("aria-label", label);
    gold.innerHTML = `<span class="coin"></span><strong>${left}</strong><span class="faint">gold</span><span class="income-chip">${net >= 0 ? "+" : "−"}${Math.abs(net)}<span class="faint">/round</span></span>`;
  } else gold.hidden = true;
}

const AIM_HINT = "It turns to follow the pointer: right-click to set its facing there (on a touch screen, tap). Left-click a highlighted tile to move it.";

/** Gold this player gets at the end of each round: the base amount plus its income sites. */
function incomePerRound(s: ClientState): number {
  const v = s.view!;
  return s.map.income.reduce((total, site, i) => total + (v.incomeOwners[i] === v.seat ? site.value : 0), RULES.baseIncome);
}

/** "72% · 27–33", or "72% · kills" for a fatal backstab: what a shot is expected to do. */
function shotSummary(p: ShotPreview): string {
  const [lo, hi] = damageRange(p);
  return `${Math.round(p.chance * 100)}% · ${p.fatal ? "kills" : lo === hi ? `${lo}` : `${lo}–${hi}`}`;
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
  // Unit counts and gold are only there for your own side during play;
  // everyone's in a replay and once the game is over.
  const counts = p.units === null ? "" : `, ${p.units} unit${p.units === 1 ? "" : "s"}`;
  const purse = p.gold === null || p.seat === v.seat ? "" : `, ${p.gold} gold`;
  const label = `${p.baseTiles} of ${home} base tiles${counts}${purse}`;
  const extra = `${p.units === null ? "" : ` · ${p.units}u`}${purse ? ` · ${p.gold}g` : ""}`;
  return `<span class="base-chip${warn ? " low" : ""}" title="${label}" aria-label="${label}">Base ${p.baseTiles}/${home}${extra ? `<span class="faint">${extra}</span>` : ""}</span>`;
}

export function renderPanel(s: ClientState): string {
  const v = s.view;
  if (!v) return `<div class="panel-section"><p class="faint">${s.connected ? "Loading the battle…" : "Connecting to the game…"}</p></div>`;
  const seat = mySeat(s);
  const parts: string[] = [];

  if (s.replay) {
    parts.push(replayBlock(s));
    const sel = s.selected;
    if (sel?.type === "unit") {
      const u = unitById(s, sel.id);
      if (u) parts.push(unitDetail(s, u));
    }
    parts.push(logBlock(s));
    return parts.join("");
  }
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
  if (seat !== null && v.phase !== "over") {
    parts.push(`<div class="panel-section keys-only key-line"><p class="faint small">${kbd("←↑→↓")} cursor · ${kbd("Enter")} act · ${kbd("Shift")}+${kbd("Enter")} ${v.phase === "planning" ? "lock in" : "done firing"} · ${kbd("?")} all keys</p></div>`);
  }
  parts.push(logBlock(s));
  if (seat !== null && v.phase !== "over" && !v.seats[seat]?.eliminated) {
    parts.push(`<div class="panel-section panel-foot"><button class="btn btn-ghost btn-sm" data-action="resign-ask" type="button">Resign</button></div>`);
  }
  return parts.join("");
}

/** The replay's controls: where it is, play and pause, a step either way, speed. */
function replayBlock(s: ClientState): string {
  const r = s.replay!;
  const v = s.view!;
  if (r.loading) return `<div class="panel-section status"><h2>Replay</h2><p>Loading the game…</p></div>`;
  const at = r.index === 0 ? "The start" : v.phase === "over" ? "The end" : `Round ${v.round} · ${v.phase === "planning" ? "planning" : "attacks"}`;
  const btn = (action: string, label: string, aria: string, disabled = false, extra = "") =>
    `<button class="btn${extra}" type="button" data-action="${action}" aria-label="${aria}" title="${aria}"${disabled ? " disabled" : ""}>${label}</button>`;
  return `<div class="panel-section status replay">
  <h2>Replay</h2>
  <p id="replay-where">${at} · step ${r.index} of ${r.total - 1}. The fog is lifted: you see every side.</p>
  <div class="replay-progress" role="progressbar" aria-label="Replay progress" aria-valuemin="0" aria-valuemax="${r.total - 1}" aria-valuenow="${r.index}"><span style="width:${Math.round((r.index / Math.max(1, r.total - 1)) * 100)}%"></span></div>
  <div class="btn-row replay-controls">
    ${btn("replay-restart", "⏮", "Back to the start", r.index === 0)}
    ${btn("replay-back", "◀", "Back a step", r.index === 0)}
    ${btn(r.playing ? "replay-pause" : "replay-play", r.playing ? "Pause" : "Play", r.playing ? "Pause" : "Play", false, " btn-primary grow")}
    ${btn("replay-forward", "▶", "Forward a step", r.index >= r.total - 1)}
    ${btn("replay-speed", `${r.speed}×`, `Speed ${r.speed}×: change it`)}
  </div>
  <p class="faint small keys-only">${kbd("Space")} play or pause · ${kbd("←")} ${kbd("→")} a step · ${kbd("Esc")} leave</p>
  <button class="btn btn-ghost btn-sm" data-action="replay-exit" type="button">Leave the replay</button>
</div>`;
}

function statusBlock(s: ClientState): string {
  const v = s.view!;
  const seat = mySeat(s);
  let title = "";
  let sub = "";
  if (v.phase === "over") {
    title = v.winner === null ? "Draw" : v.winner === seat ? "Victory" : `${esc(playerName(s, v.winner))} wins`;
    sub = v.winner === seat ? "The field is yours." : "The fog has lifted. Look around the whole map.";
    return `<div class="panel-section status status-over"><h2>${title}</h2><p>${sub}</p>
  <button class="btn btn-primary" data-action="replay-start" type="button">Watch the replay</button>
  <a class="btn" href="/">Back to your games</a></div>`;
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
    if (isMyAttackTurn(s) && v.burst) {
      const u = unitById(s, v.burst.unitId);
      title = "Another shot";
      sub = `Your ${u ? esc(UNITS[u.kind].name.toLowerCase()) : "unit"} can fire again: pick a target, or hold.`;
    } else if (isMyAttackTurn(s)) {
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
      const route = routeFor(s, u.id);
      const plan = route ? routePlan(s, u, route) : null;
      let what = order?.path.length ? `Moving ${order.path.length} step${order.path.length === 1 ? "" : "s"}` : order ? "Turning on the spot" : "Holding position";
      // A route over several rounds: how many rounds it takes, this one included.
      if (route) what += plan ? ` · route: ${plan.rounds} round${plan.rounds === 1 ? "" : "s"} to go` : " · route: no way through for now";
      const firedNote = u.fired ? `<p class="small braced-note">Fired last round: it can turn this round, but not move.</p>` : "";
      parts.push(`<div class="panel-section unit-sheet" ${seatStyle(u.seat)}>
  ${unitHeader(s, u)}
  <p class="order-line">${what}, facing ${facingName(facing)} (${facing}°).</p>
  ${firedNote}
  <div class="facing-row"><span class="faint small">Face</span>${compass(s, facing)}</div>
  <p class="faint small">${s.aiming ? AIM_HINT : "Click a highlighted tile to move there, or a tile further off to head there over several rounds; it then turns to follow the pointer. Right-click to set its facing."}</p>
  ${order || route ? `<div class="order-buttons">${order ? `<button class="btn btn-ghost btn-sm" data-action="clear-order" data-unit="${u.id}" type="button">Clear order</button>` : ""}${route ? `<button class="btn btn-ghost btn-sm" data-action="cancel-route" data-unit="${u.id}" type="button">Cancel route</button>` : ""}</div>` : ""}
</div>`);
    }
  } else if (sel?.type === "spawnTile") {
    const left = goldLeft(s);
    parts.push(`<div class="panel-section"><h3 class="panel-h">Deploy a unit</h3><div class="shop">${UNIT_KINDS.map((k, i) => {
      const u = UNITS[k];
      const can = u.cost <= left;
      return `<button class="shop-item" type="button" data-action="buy" data-kind="${k}"${can ? "" : " disabled"} title="${esc(u.role)}">
  <span class="unit-badge" ${seatStyle(v.seat!)}>${glyph(k)}</span><span class="shop-name">${esc(u.name)}</span><span class="shop-cost">${u.cost}g${RULES.upkeep ? `<small class="faint" title="Upkeep a round"> +${Math.round(unitUpkeep(k) * 10) / 10}/rd</small>` : ""}</span>${kbd((i + 1) % 10)}
</button>`;
    }).join("")}</div><p class="faint small">${left} gold left this round.</p></div>`);
  } else if (sel?.type === "spawn") {
    const sp = s.draft.spawns[sel.index];
    if (sp) {
      parts.push(`<div class="panel-section unit-sheet" ${seatStyle(v.seat!)}>
  <div class="unit-head"><span class="unit-badge">${glyph(sp.kind)}</span><div><h3>${esc(UNITS[sp.kind].name)}</h3><p class="faint small">Deploying · ${UNITS[sp.kind].cost} gold</p></div></div>
  <p class="faint small">${esc(UNITS[sp.kind].role)}</p>
  <div class="facing-row"><span class="faint small">Face</span>${compass(s, sp.facing)}</div>
  <p class="faint small">${s.aiming ? AIM_HINT : `Facing ${facingName(sp.facing)} (${sp.facing}°). Right-click where it should face, or click it again to aim.`}</p>
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
    const shots = UNITS[shooter.kind].shots;
    const burst = v.burst?.unitId === shooter.id ? v.burst : null;
    if (acted) parts.push(`<p class="faint small">Already acted this round.</p>`);
    else if (!isArmed(shooter.kind)) parts.push(`<p class="faint small">Unarmed: this unit can't shoot.</p>`);
    else {
      if (shots > 1) parts.push(`<p class="faint small">Shot ${(burst?.fired ?? 0) + 1} of ${shots} this turn.</p>`);
      if (target) {
        const p = previewShot(s.map, shooter, target, v.units);
        parts.push(shotBreakdown(s, target, p));
        parts.push(`<div class="btn-row"><button class="btn btn-danger btn-lg grow" data-action="fire" type="button"${s.pending ? " disabled" : ""}>Fire · ${shotSummary(p)}</button><button class="btn" data-action="untarget" type="button">Back</button></div>`);
      } else if (targets.length) {
        parts.push(`<h3 class="panel-h">Targets</h3><ul class="target-list">${targets
          .map((t, i) => {
            const p = previewShot(s.map, shooter, t, v.units);
            return `<li><button class="target-item" type="button" data-action="target" data-target="${t.id}" ${seatStyle(t.seat)}><span class="unit-badge sm">${glyph(t.kind)}</span><span>${unitLabel(s, t)}<small class="faint">${t.hp} hp · ${p.flank}${p.inCover ? " · in cover" : ""}</small></span><strong>${shotSummary(p)}</strong>${kbd((i + 1) % 10)}</button></li>`;
          })
          .join("")}</ul>`);
      } else parts.push(`<p class="faint small">Nothing this unit can hit from here.</p>`);
    }
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
  const [lo, hi] = damageRange(p);
  const dmg = p.fatal ? "Kills" : lo === hi ? `${lo}` : `${lo}–${hi}`;
  const rows = p.modifiers
    .map((m) => `<li><span>${esc(m.label)}</span><span>${m.factor === 1 ? "—" : `×${m.factor.toFixed(2)}`}</span></li>`)
    .join("");
  return `<div class="shot" ${seatStyle(target.seat)}>
  <div class="shot-head"><span class="unit-badge sm">${glyph(target.kind)}</span><span>${unitLabel(s, target)}<small class="faint">${target.hp} / ${UNITS[target.kind].hp} hp</small></span></div>
  <dl class="shot-stats"><div><dt>Hit chance</dt><dd>${Math.round(p.chance * 100)}%</dd></div><div><dt>Damage</dt><dd>${dmg}</dd></div><div><dt>Angle</dt><dd>${p.flank}</dd></div></dl>
  ${p.fatal ? `<p class="small"><strong>From behind, this close: a hit kills outright.</strong></p>` : `<p class="faint small">A critical hit (${Math.round(RULES.critChance * 100)}% of hits) does ${RULES.critMultiplier}× damage.</p>`}
  ${p.splash ? `<p class="small">Blast: ${p.splash} damage to every unit next to the target, yours too, and to the target on a miss.</p>` : ""}
  ${rows ? `<ul class="mods">${rows}</ul>` : `<p class="faint small">Clean shot: no modifiers.</p>`}
</div>`;
}

function unitHeader(s: ClientState, u: Unit): string {
  const st = UNITS[u.kind];
  const f = u.hp / st.hp;
  return `<div class="unit-head"><span class="unit-badge">${glyph(u.kind)}</span><div class="grow"><h3>${esc(st.name)}</h3>
  <div class="hp-bar" role="img" aria-label="${u.hp} of ${st.hp} health"><span style="width:${Math.round(f * 100)}%" class="${f > 0.6 ? "ok" : f > 0.3 ? "warn" : "danger"}"></span></div>
  <p class="faint small">${u.hp}/${st.hp} hp · move ${st.move} · ${isArmed(u.kind) ? `range ${st.range} · aim ${st.accuracy}%${st.shots > 1 ? ` · ${st.shots} shots` : ""}` : "unarmed"}</p>
  ${hasTrait(u.kind, "steady") ? `<p class="small braced-note">${u.moved ? "Moved this round: not braced, half accuracy." : "Braced: full accuracy while it stays put."}</p>` : ""}</div></div>`;
}

function unitDetail(s: ClientState, u: Unit): string {
  const st = UNITS[u.kind];
  return `<div class="panel-section unit-sheet" ${seatStyle(u.seat)}>${unitHeader(s, u)}
  <p class="faint small">${unitLabel(s, u)}. ${esc(st.role)}</p>
  ${st.traits.length ? `<ul class="traits">${st.traits.map((t) => `<li>${esc(TRAIT_TEXT[t])}</li>`).join("")}</ul>` : ""}
</div>`;
}

/** Eight quick facings round an Aim button (aim: the unit follows the pointer until a tap). */
function compass(s: ClientState, current: Facing): string {
  // 3x3 grid; cells are eighths of a turn round the centre.
  const cells: (number | null)[] = [7, 0, 1, 6, null, 2, 5, 4, 3];
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return `<div class="compass" role="group" aria-label="Facing">${cells
    .map((f) =>
      f === null
        ? `<button type="button" class="aim" data-action="aim" aria-pressed="${!!s.aiming}" aria-label="Aim with the pointer" title="Aim: the unit follows the pointer until you tap">◎</button>`
        : `<button type="button" data-action="set-facing" data-facing="${f * 45}" aria-pressed="${f * 45 === current}" aria-label="Face ${FACING_NAME[f]}">${arrows[f]}</button>`,
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
