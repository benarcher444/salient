// Download a stored game from the live server for review.
//   npm run fetch-game                  list the 20 most recent games
//   npm run fetch-game -- latest        the most recently finished game
//   npm run fetch-game -- <id>          that game (finished or not)
// Saves data/reviews/<id>.json, which scripts/analyse-game.ts reads.
// Needs ADMIN_TOKEN in .env (the same value as on the server) and, for
// anything but production, SALIENT_URL.
import "../src/env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = (process.env.SALIENT_URL ?? "https://salient.91-99-202-188.sslip.io").replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN;
if (!token) {
  console.error("ADMIN_TOKEN is not set in .env.");
  process.exit(1);
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(base + url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${url}: ${res.status} (a 404 for everything means the token is wrong or unset on the server)`);
  return (await res.json()) as T;
}

interface Listed {
  id: string;
  map: string;
  status: string;
  round: number;
  winnerSeat: number | null;
  players: { seat: number; name: string; isBot: boolean }[];
  updatedAt: number;
}

const which = process.argv[2];
const list = await get<Listed[]>("/admin/games?limit=20");
if (!which) {
  for (const g of list) {
    const when = new Date(g.updatedAt).toISOString().slice(0, 16).replace("T", " ");
    console.log(`${g.id}  ${when}  ${g.status.padEnd(6)}  round ${String(g.round).padStart(3)}  ${g.map.padEnd(14)}  ${g.players.map((p) => p.name).join(", ")}`);
  }
  process.exit(0);
}
const id = which === "latest" ? list.find((g) => g.status === "over")?.id : which;
if (!id) {
  console.error("No finished game in the 20 most recent.");
  process.exit(1);
}
const game = await get<unknown>(`/admin/games/${encodeURIComponent(id)}`);
const dir = path.resolve("data", "reviews");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${id}.json`);
writeFileSync(file, JSON.stringify(game));
console.log(file);
