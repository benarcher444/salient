// A consistent copy of the database, through SQLite's online backup API (a
// plain file copy can catch a write half-done and, in WAL mode, miss what is
// still in the -wal file). Backups are labelled by kind and pruned per label,
// so a second deploy in a day can never overwrite the only good copy.
//   npx tsx scripts/backup-db.ts [--label=app] [--keep=14]
import "../src/env.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { sqlite } from "../src/db/index.js";

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const label = arg("label", "app");
const keep = Number(arg("keep", "14"));
if (!/^[a-z-]+$/.test(label) || !Number.isInteger(keep) || keep < 1) {
  console.error("Bad --label or --keep.");
  process.exit(1);
}
const dir = path.join(path.dirname(config.databasePath), "backups");
fs.mkdirSync(dir, { recursive: true });
// Nightly copies are one per day; pre-deploy copies are timestamped.
const stamp = label === "app" ? new Date().toISOString().slice(0, 10) : new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = path.join(dir, `${label}-${stamp}.db`);
await sqlite.backup(target);
console.log(`Backed up to ${target}`);

const mine = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith(`${label}-`) && f.endsWith(".db"))
  .sort();
for (const old of mine.slice(0, Math.max(0, mine.length - keep))) {
  fs.rmSync(path.join(dir, old));
  console.log(`Pruned ${old}`);
}
