// Watching a finished game again: its log, rebuilt step by step with the fog
// lifted. Pure, like the rest of src/game: the server sends the log, the
// browser replays it with the same rules, tuning, map and dice, so every step
// is exactly what happened.
import { streamFor } from "./rng.js";
import { applyAction, newGame } from "./rules.js";
import { RuleError, type Action, type GameEvent } from "./types.js";
import { viewFor, type PlayerView } from "./view.js";

/** A finished game's log, as the server sends it for a replay. */
export interface ReplayLog {
  /** The game's seed: with each action's seq it picks that action's dice. */
  seed: string;
  seatCount: number;
  /** Every action in log order, already in today's terms (older games upgraded). */
  actions: { seq: number; action: Action }[];
}

/** One moment of the replay: what everyone could see, and what led to it. */
export interface ReplayStep {
  /** The whole board, fog lifted (viewFor with no seat). */
  view: PlayerView;
  /** What happened in this step, for the animation and the battle log. */
  events: GameEvent[];
  /** The round the step happened in (a round's last shot ends that round). */
  round: number;
}

/**
 * Rebuild a game from its log. Step 0 is the empty board before anything
 * happened; then one step per action that changed something (a set of
 * orders that only waited for the other players is not a step). A log
 * stored under older rules code stops where today's rules refuse it, as the
 * server's own replay does. Run under the game's tuning (the caller's job).
 */
export function replaySteps(mapId: string, log: ReplayLog): ReplayStep[] {
  let state = newGame(mapId, log.seatCount);
  const steps: ReplayStep[] = [{ view: viewFor(state, null), events: [], round: 1 }];
  for (const { seq, action } of log.actions) {
    if (state.phase === "over") break;
    const round = state.round;
    try {
      const r = applyAction(state, action, streamFor(log.seed, seq));
      state = r.state;
      if (r.events.length) steps.push({ view: viewFor(state, null), events: r.events, round });
    } catch (e) {
      if (e instanceof RuleError) break;
      throw e;
    }
  }
  return steps;
}
