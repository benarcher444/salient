# Salient — handbook

This is the project's own handbook: what the app is, the decisions behind it,
the traps found while building it, and how to check a change. Read it before
changing anything. The general standard it is built to lives in
[`playbook.md`](playbook.md) (stack defaults, theming, mobile, accounts,
deployment); where this file differs, this file wins, and says why.

## The shape

**Salient is a turn-based tactics game for two to four players in the
browser.** Each side buys units onto its base, captures command posts (which
become forward spawn points) and income sites, and fights through fog of war.
Every round, everyone plans their moves secretly and at the same time; moves
resolve together; then players take turns firing one unit at a time.

- **Who signs in:** invited players (email + password). Computer opponents are
  accounts too, flagged `is_bot`, that can never sign in.
- **What it stores:** users, sessions, games, game players, and each game's
  **action log**. A game's state is never stored, only rebuilt (see below).
- **First screen:** the lobby, "Your games", with the new-game form beside it.

It grew out of a 2021 pygame prototype in `old_code/`, kept for reference.
The prototype's ideas carried over: bases, command posts that become spawn
points, income sites only engineers can work, walls and windows, line of
sight, fog of war, a firing cone, damage depending on which side you are hit
from, and a window near the shooter costing less than one near the target.
None of its code did.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Run the server (`PORT`, default 3000; locally `.env` sets 3100) |
| `npm run dev` | Same, restarting on changes to `src/` |
| `npm run typecheck` | `tsc` over `src/` and `scripts/` |
| `npm test` | The rules engine, exhaustively (no server, no browser) |
| `npx tsx scripts/simulate.ts` | Bots against bots, many games in memory: smoke test and balance report |
| `npm run test:flow` | Two real browsers play a game, then one plays the computer (server running, seeded) |
| `npm run audit:mobile` | Phone-width audit: tap targets, 16px inputs, overflow (server running, seeded) |
| `npm run shot` | Screenshot every page, 1440 and 390 wide, light and dark (`--only=`, `--light`, `--desktop`, `--viewport`) |
| `npm run test:all` | All of the above that need no flags, in order |
| `npm run seed` / `npm run unseed` | Add / remove the demo accounts (`scripts/demo.ts`) and their games |
| `npm run set-password -- <email> <pw>` | Replace a password (they cannot be recovered) |
| `npm run unlock -- <email>` | Unlock an account after five wrong passwords |
| `npm run backup` | Consistent database copy into `data/backups/` |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |

Browser suites and screenshots need the server running and `npm run seed`
done. **Restart the server after any change under `src/`** — it does not
reload, and a pass run against the old process verifies the old code.
`public/` and the browser bundle are served fresh.

## Layout

```
src/game/        The rules. Pure TypeScript, no Node or DOM imports: the server
                 and the browser both run it. types, grid (tiles, edges,
                 directions), los (line of sight), movement, combat, visibility
                 (fog, spawn tiles), rules (the round structure, applyAction),
                 view (what one seat may know), maps, units, constants, rng,
                 bot (the computer opponent), seats, glyphs.
src/client/      The battle page in the browser: game.ts (controller, socket,
                 taps), board.ts (canvas drawing), art.ts (the cached map art),
                 animate.ts, camera.ts (pan, zoom, gestures), panel.ts (side
                 panel HTML), state.ts, palette.ts.
src/games.ts     Games as records: create, join, act, replay, the bot driver.
src/routes/      HTTP and the game WebSocket. No rules.
src/views/       Server-rendered pages, icons, map thumbnails.
public/          styles.css (all tokens) and two small plain-JS page scripts.
scripts/         Tests, seeding, screenshots, audits, simulation, admin.
drizzle/         Migrations (committed). deploy/  Server files.
```

## Decisions and why

**TypeScript throughout, not a Python server.** The browser needs the rules:
it shows the hit chance before you fire, the tiles a unit can reach, the
route. With the rules in TypeScript the exact same functions run in both
places, so the number on screen is the number the server rolls. Two copies
of the rules would drift. The playbook's server also runs Node.

**Games are an action log, replayed.** `game_actions` holds every action;
`newGame()` plus `applyAction()` over the log rebuilds the state. Dice come
from `streamFor(seed, seq)`, a separate stream per action, so a replay rolls
identically and one action's rolls can never shift another's. The summary
columns on `games` (status, round, phase, winner) exist so the lobby needs no
replay, and are recomputed from the state on every write, never edited. This
is the playbook's "rebuild aggregates from the event log" rule applied to a
game. A restart rebuilds the in-memory cache from the log.

**The server is the authority and sends each player only their view.**
`viewFor(state, seat)` filters to the seat's own units and the enemies it can
see; gold and orders of other seats never leave the server. The seat comes
from the session, never the message. The prototype sent every unit to every
client, so its fog was cosmetic. An outsider can open a finished game, never
one in progress (they would see through everyone's fog).

**Tiles, eight facings, simultaneous moves, attacks in turn.** Chosen with the
owner over the prototype's free movement. Moves resolve in lockstep, one step
per tick: two units wanting one tile both stop, swaps are refused, and walking
into an unseen enemy stops you facing it. The rule looks only at the current
tick, so the result never depends on unit order. Attack turns go round the
table one unit at a time; the first shooter rotates each round; a seat with
nothing in reach is skipped automatically.

**Line of sight runs in integer arithmetic.** Sight lines go from tile centre
to tile centre, and those very often pass exactly through a tile corner. The
grid walk in `los.ts` compares crossings by cross-multiplied integers, so
corners are decided exactly, never by rounding. At a corner, a single wall
ending there only grazes the line; an L of walls (a room corner) or a straight
wall blocks it. Pinned in `scripts/test-rules.ts`.

**Maps are drawn once and rotated for every seat.** A map draws one seat's
share through a "pen" and the builder replays it rotated (half turn for two
seats, quarter turns for four). The rules test checks each built-in map is
symmetric, its bases equal, and every site reachable.

**Bots decide from a PlayerView only.** `src/game/bot.ts` gets exactly what a
human in that seat gets, so it cannot cheat. It lives in `src/game` so the
simulator can run it without a server. On the server, `driveBots()` runs after
every action, waits a moment (600 ms planning, 1.3 s attacks, so shots don't
overlap the last animation) and decides when the timer fires, from the state
at that time. A refused bot action falls back to the always-legal one (empty
orders, end attacks) so humans are never left waiting. `resumeBots()` at
startup picks up games left waiting on a bot.

**The browser bundle is built in memory by esbuild.** The client is
TypeScript sharing `src/game`, so it needs bundling; the playbook's "no build
step" is kept by building at boot in production and per request in
development. There is no `dist/` to go stale, and a deploy stays pull,
install, restart. `esbuild` is in `dependencies` for that reason. This is a
deliberate departure from the playbook's "plain JS in public/": the battle is
the stateful-canvas case the playbook names as the exception. Ordinary pages
are still server-rendered HTML.

**The board is a canvas whose colours come from CSS.** `palette.ts` reads the
`--t-*`, `--seat-*`, `--site-*` and `--board-*` custom properties, so the board
follows light and dark like everything else. Those tokens must be **hex**: the
art does colour arithmetic on them. The map art is drawn once per map and
theme into an offscreen canvas (`ART_PX` per tile) and scaled each frame.

**Theme on the account**, stamped into `<html>` at render: no flash. The
battle page re-reads the palette when the device scheme changes.

**Economy and tickets, Battlefront-style.** 40 tickets each; −2 per unit lost;
at round end each seat bleeds 2 per command post the strongest opponent holds
beyond its own; out at zero; most tickets at round 30 wins. 300 gold to start,
+50 a round, +25 per income site. All in `src/game/constants.ts`; unit stats
in `src/game/units.ts`. Use `scripts/simulate.ts` to see what a change does.

## Traps worth remembering

**A bot that buys the best it can afford buys nothing but scouts.** A round's
income rarely covers anything dearer, so "best affordable" collapses to the
cheapest. The bot now picks what it wants first and saves up if it can't
afford it. The simulator's purchase counts are what caught it.

**The map was fitted once and never again.** The canvas is sized before the
side panel fills in, so on a phone the first fit used the wrong height and
most of the map sat off-screen. The board now re-fits on every resize until
the player pans or zooms (`board.userMoved`).

**`--accent` is parchment in dark mode.** Unit badges defaulted their colour
to it and their white glyph vanished. Badges now use `var(--seat, slate)`.

**Banners fire late.** Phase banners wait for the update's animation, by which
time another update may have arrived; "Round 3 · Plan your moves" showed during
the attack phase. Each banner now checks the view it was made for is still
current.

**A single Playwright `mouse.move` jumps.** It delivers no move events in
between, so hover-driven drawing (the route preview) never sees it. Move in
steps in tests.

**The mobile audit's prose exemption was too broad.** It skipped any link
whose parent had long text, which included the whole header, so a 26px-tall
brand link passed. It now only exempts links inside `p`, `li`, `dd`, `.prose`.

**Fonts a fraction of a pixel tall render badly on canvas.** Labels on the
board are drawn in screen pixels, not tile units, for that reason.

**Fog at one pixel per tile looks like clouds.** Smoothing a 25×17 image up to
the board smears each tile across its neighbours. Four pixels per tile softens
only the edges.

**Seeding writes straight to the database**, past the server's cache. Restart
the server after `seed`/`unseed`, or it serves games that no longer exist.

## Adding things

- **A unit class:** an entry in `UNITS` (`src/game/units.ts`), its kind in
  `UnitKind` (`types.ts`), a glyph in `glyphs.ts`, and if it has a new trait,
  the rule where the trait applies (`combat.ts` or `rules.ts`) plus
  `TRAIT_TEXT`. The shop, rules page, bot and panel pick it up from there.
- **A map:** a builder block in `src/game/maps.ts`, added to `MAPS`. Two-seat
  maps are rotated a half turn, four-seat maps must be square. Run `npm test`:
  it checks symmetry, bases and reachability.
- **A rule change:** `src/game/rules.ts` or `combat.ts`, a test in
  `scripts/test-rules.ts`, then `npx tsx scripts/simulate.ts` to see it play.
  Remember stored games replay their logs under the new rules.

## Verification before calling a change done

1. `npm run typecheck`, `npm test`, and the simulator if rules or the bot moved.
2. Restart the server; `npm run unseed && npm run seed`; restart again.
3. `npm run test:flow`, `npm run audit:mobile`, `npm run shot` — and look at
   the images. All at zero warnings.
4. Update this file in the same change.

## Deployment

Live at **https://salient.91-99-202-188.sslip.io**, deployed by GitHub
Actions on every push to `main` (when the `DEPLOY_ENABLED` repository
variable is `true`). The path is the playbook's, steps 1–7.

Port register, as read from the server on 2026-11-08 (`ss -tlnp`, the Caddy
site files, `/opt`). Check again before trusting it, and never touch the
other apps' users, folders, databases, services or site files.

| App | Hostname | Port | Folder | Service |
|---|---|---|---|---|
| lingo | 91-99-202-188.sslip.io | 3000 | /opt/lingo | lingo |
| fuel | fuel.91-99-202-188.sslip.io | 3001 | /opt/fuel | fuel |
| **salient** | salient.91-99-202-188.sslip.io | **3002** | /opt/salient | salient (user `salient`) | `deploy/deploy.sh`
is installed by hand as `/usr/local/bin/salient-deploy`, the only command the
GitHub deploy key may run; reinstall it after editing. The invite list is
`/opt/salient/invites.txt` (gitignored, one address per line, read on every
request). Nightly backups via `salient-backup.timer`; they live on the
server's own disk, so they undo mistakes but do not survive losing the server.
