// Seed demo accounts and one game in progress, for the screenshot pass and the
// browser suites. Additive and safe to re-run: existing demo accounts are
// reused, and only demo accounts are ever touched. Undo with `npm run unseed`.
//   npx tsx scripts/seed.ts
import "../src/env.js";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/auth.js";
import { db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { gamePlayers, users } from "../src/db/schema.js";
import { act, createGame, joinGame, loadGame } from "../src/games.js";
import { getMap } from "../src/game/maps.js";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "./demo.js";

runMigrations();
const hash = await hashPassword(DEMO_PASSWORD);
const ids: number[] = [];
for (const a of DEMO_ACCOUNTS) {
  const existing = db.select().from(users).where(eq(users.email, a.email)).get();
  const user =
    existing ?? db.insert(users).values({ email: a.email, displayName: a.name, passwordHash: hash, createdAt: Date.now() }).returning().get();
  // Re-running resets a demo account's password and lock, so suites can always sign in.
  db.update(users).set({ passwordHash: hash, failedLogins: 0, lockedAt: null }).where(eq(users.id, user.id)).run();
  ids.push(user.id);
  console.log(`  ${existing ? "kept " : "added"} ${a.email}`);
}
const [alex, sam] = ids as [number, number];

const hasGame = db.select().from(gamePlayers).where(eq(gamePlayers.userId, alex)).all().length > 0;
if (!hasGame) {
  // A Crossroads game a round in: both sides deployed and advancing.
  const id = createGame(alex, "crossroads", 2);
  joinGame(id, sam);
  const map = getMap("crossroads");
  const b0 = map.bases[0]!;
  const b1 = map.bases[1]!;
  act(id, alex, {
    type: "orders",
    orders: {
      moves: [],
      spawns: [
        { kind: "rifleman", ...b0[0]!, facing: 2 },
        { kind: "engineer", ...b0[4]!, facing: 2 },
        { kind: "scout", ...b0[2]!, facing: 2 },
      ],
    },
  });
  act(id, sam, {
    type: "orders",
    orders: {
      moves: [],
      spawns: [
        { kind: "heavy", ...b1[2]!, facing: 6 },
        { kind: "rifleman", ...b1[0]!, facing: 6 },
      ],
    },
  });
  const state = loadGame(id)!.state!;
  const scout = state.units.find((u) => u.seat === 0 && u.kind === "scout")!;
  const heavy = state.units.find((u) => u.seat === 1 && u.kind === "heavy")!;
  const path = (from: { x: number; y: number }, steps: [number, number][]) => steps.map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy }));
  act(id, alex, {
    type: "orders",
    orders: { moves: [{ unitId: scout.id, path: path(scout, [[1, 0], [2, 0], [3, 0], [4, 0]]), facing: 2 }], spawns: [] },
  });
  act(id, sam, {
    type: "orders",
    orders: { moves: [{ unitId: heavy.id, path: path(heavy, [[-1, 0], [-2, 0]]), facing: 6 }], spawns: [] },
  });
  const after = loadGame(id)!.state!;
  console.log(`  added game #${id} (round ${after.round}, ${after.phase})`);
} else console.log("  kept the demo game");

// An open game with a free seat, so the lobby and waiting room have one to show.
const robinGames = db.select().from(gamePlayers).where(eq(gamePlayers.userId, ids[2]!)).all();
if (robinGames.length === 0) console.log(`  added open game #${createGame(ids[2]!, "riverside", 2)}`);
console.log("\nDemo accounts use the password in scripts/demo.ts.\n");
