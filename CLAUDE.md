# Salient â€” handbook

This is the project's own handbook: what the app is, the decisions behind it,
the traps found while building it, and how to check a change. Read it before
changing anything. The general standard it is built to lives in
[`playbook.md`](playbook.md) (stack defaults, theming, mobile, accounts,
deployment); where this file differs, this file wins, and says why.

## The shape

**Salient is a turn-based tactics game for two to four players in the
browser.** Each side buys units onto its base, captures command posts (which
become forward spawn points) and income sites, and fights through fog of war.
Bases are captured tile by tile; a side with no base tiles and no units left
is out, and the last side standing wins.
Every round, everyone plans their moves secretly and at the same time; moves
resolve together; then players take turns firing one unit at a time.

- **Who signs in:** invited players (email + password). Computer opponents are
  accounts too, flagged `is_bot`, that can never sign in. Guests (anyone with
  a game's invite link) get a seat in that one game without an account.
- **What it stores:** users, sessions, games (each with a snapshot of its
  map), game players, each game's **action log**, and the maps people make in
  the editor. A game's state is never stored, only rebuilt (see below).
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
| `npm run test:editor` | The map editor in a real browser: symmetry, tools, undo, autosave, playing a map, deleting it (server running, seeded) |
| `npm run test:keys` | A game against the computer played with the keyboard alone (server running, seeded) |
| `npm run test:guest` | A guest joins by invite link, plays, and is kept out of everything else; full games and replaced links refuse (server running, seeded) |
| `npm run audit:mobile` | Phone-width audit: tap targets, 16px inputs, overflow (server running, seeded) |
| `npm run shot` | Screenshot every page, 1440 and 390 wide, light and dark (`--only=`, `--light`, `--desktop`, `--viewport`) |
| `npx tsx scripts/shot-units.ts` | Every unit class on the board, both sides, close up, light and dark (no server) |
| `npm run test:all` | All of the above that need no flags, in order |
| `npm run seed` / `npm run unseed` | Add / remove the demo accounts (`scripts/demo.ts`) and their games |
| `npm run set-password -- <email> <pw>` | Replace a password (they cannot be recovered) |
| `npm run unlock -- <email>` | Unlock an account after five wrong passwords |
| `npm run delete-games -- --in-play` | Delete every unfinished game (or `-- <id>...`; `--dry-run` lists). Restart the server after |
| `npm run backup` | Consistent database copy into `data/backups/` |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |

Browser suites and screenshots need the server running and `npm run seed`
done. **Restart the server after any change under `src/`** â€” it does not
reload, and a pass run against the old process verifies the old code.
`public/` and the browser bundle are served fresh.

## Layout

```
src/game/        The rules. Pure TypeScript, no Node or DOM imports: the server
                 and the browser both run it. types, grid (tiles, edges,
                 directions), los (line of sight), movement, combat, visibility
                 (fog, spawn tiles), rules (the round structure, applyAction),
                 view (what one seat may know), maps, units, constants, rng,
                 bot (the computer opponent), seats, glyphs (class symbols and
                 silhouettes), keys (the keyboard controls list), tuning
                 (loads and checks /tuning, the active numbers).
tuning/          The balance numbers as JSON: units/<class>.json, rules.json,
                 and a README explaining every field. Edited by hand.
src/client/      The browser. game.ts (the battle: controller, socket, taps),
                 board.ts (battle drawing), editor.ts (the map editor),
                 art.ts (the cached map art), sites.ts (posts and income
                 sites, shared by both), animate.ts, camera.ts (pan, zoom,
                 gestures), panel.ts (battle side panel), state.ts, palette.ts.
src/games.ts     Games as records: create, join, act, replay, map snapshots,
                 the bot driver.
src/saved-maps.ts  Maps made in the editor: storing, the save schema, copying.
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

**Tiles, free facing, simultaneous moves, attacks in turn.** Chosen with the
owner over the prototype's free movement. Moves resolve in lockstep, one step
per tick. A side's own units pass through each other (the owner's call):
only enemies block, so two sides wanting one tile both stop, a swap with an
enemy is refused, and walking into an unseen enemy stops you facing it.
Nobody finishes on a shared tile: afterwards the later arrival steps back
along its route until every tile holds one unit. The rule looks only at the current
tick, so the result never depends on unit order. Attack turns go round the
table one unit at a time; the first shooter rotates each round; a seat with
nothing in reach is skipped automatically. A unit with more than one shot
(the commando) keeps its side's turn for all of them (`state.burst`), and
may switch targets between them.

**A facing is any whole degree, 0..359** (0 north, clockwise). It was one of
eight; the owner wanted to point anywhere. Whole degrees keep the action log
exact. In the battle (the owner's scheme), a left click sets a route and
leaves the unit turning to follow the pointer (`s.aiming`); a right click
sets the facing at the pointer and deselects (right-clicking any selected
unit or deployment does the same); a left click while aiming is an ordinary
click. Touch has no right click, so there the tap after a route sets the
facing (`tap` gets the `pointerType`). Enter never starts aiming, or the
keyboard would need a second press. Tapping a ghost or a deployment aims it; Q/E turn 15Â° (Shift 45Â°), R points at the
cursor, and the panel's compass has the eight quick facings round an Aim
button.

**Line of sight runs in integer arithmetic.** Sight lines go from tile centre
to tile centre, and those very often pass exactly through a tile corner. The
grid walk in `los.ts` compares crossings by cross-multiplied integers, so
corners are decided exactly, never by rounding. At a corner, a single wall
ending there only grazes the line; an L of walls (a room corner) or a straight
wall blocks it. Pinned in `scripts/test-rules.ts`.

**Every game carries its own copy of its map.** `games.map_data` holds the
map as it was when the game was created; `mapFor()` registers it with the
rules under the key `game:<id>`, and that key is the state's `mapId`. Games
replay their logs, so if a map could change under a game its history would
replay into a different game. This makes editing or deleting a map, or
changing a built-in map in code, safe for games already played. (Games from
before snapshots have no `map_data` and use the built-in map by id.) The
battle page sends its snapshot to the browser, which registers it the same
way, since custom maps are not in the bundle.

**The editor works through four primitives and the symmetry transforms.**
Every tool is built from `setTerrain`, `setEdge` and `placeSite`, each applied
once per image from `symmetryTransforms()` â€” the same rotations the built-in
maps are drawn with, so "mirror" in the editor means exactly what it means in
`maps.ts`. A base painted for seat s puts image k in seat s+k. A stroke is
one undo step (snapshot at pointer-down, compared at pointer-up). Edits
autosave 0.7 s after they stop; text fields save but are not undo steps.
`checkMap()` (`src/game/mapcheck.ts`) is the single definition of
"playable": the editor lists its problems live and disables Play, the server
refuses to start a game on a map with any, and the rules test runs every
built-in map through it. Saved maps are private to their owner; any id that
is not yours resolves to nothing.

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

**Every class has its own silhouette, turned to its facing.** Units were
discs with a small nose, and players could tell neither the classes apart nor
which way anything faced. Now `UNIT_SHAPE` (`src/game/glyphs.ts`) gives each
class a shape (rifleman circle, scout diamond, engineer gear, heavy hexagon,
sniper triangle, riot shield, commando dart, shotgun chamfered square,
healer cross, officer star) and
`UNIT_SIZE` a size; the board rotates the shape to the facing and draws a
white arrow in front, with the symbol kept upright. The panel and the rules
page draw the same shapes as SVG (`unitBadgeSvg`), so a class looks the same
everywhere. The unit under the cursor shows its firing arc, enemies' too.
Health is a bar under the token, not a ring, because rings don't fit shapes.
A sniper that hasn't moved carries a tripod badge (braced: full accuracy);
a healer or officer under the cursor or selected shows the square its help
reaches; a sniper's arc includes its scope's long strip; unarmed units have
no arc. The battle board always fills its area (`Camera` with `fill`): no
zooming out past it and no panning off the edge, so there is never an empty
frame round the map. The editor keeps the whole-map fit. Under the side panel a minimap (`drawMinimap`) shows the whole map, the fog, the units this player can see and a box for the board's view; clicking or dragging it moves the view. Phones hide it: the bottom sheet has no room.

**The whole battle can be played from the keyboard.** A cursor square is
always on the board (`s.hover`; the mouse moves it too and leaving the board
no longer clears it) and every key acts on it or on the selection, through
the same functions taps and buttons use, so nothing behaves differently by
input. The keys are listed once in `src/game/keys.ts`, rendered by the
battle's `?` overlay and the How to play page; the handling is `onKey` in
`src/client/game.ts`, so change both together. Enter, Space and Tab are left
alone on a focused button or link. Key hints are hidden on touch screens and
narrow windows.

**A game's creator can delete it at any stage** (the lobby card's Delete,
then a confirm page: no browser pop-ups), for everyone in it; its players and
log cascade. `removeGame` in `games.ts` also stops its bot timer, drops it
from the cache and tells open pages it has gone. Nobody else can, and there
is no admin: `npm run delete-games` on the server is the owner's tool.

**Guests join one game by its invite link, and can reach nothing else.**
The owner wanted people without an account to be able to play from a link,
without opening the invite-only sign-up. The waiting room's link is
`/g/<id>/invite/<token>` (`games.invite_token`, 144 random bits, made when
first shown, replaced by "New link", which kills older links; it is read
from the database, never the game cache, which predates it). A signed-in
visitor gets the ordinary Join button. Anyone else gets a display name
field: that makes a `users` row with `is_guest`, `guest_game_id`, an address
under `.invalid` and no usable password (`signIn` refuses guests, like
bots), a session, and the open seat. A full or started game's link turns
guests away. The restriction is one `onRequest` hook (`guestGuard`,
`src/guest.ts`) over the allow-list in `src/guest-paths.ts`: their game's
page, its socket, the invite link, `/static/`, `/how-to-play` and sign-out.
Pages redirect to their game, everything else is 403, so **a new route is
closed to guests until it is listed there**. Guests show as "Name (guest)";
signing out ends a guest's access for good. `unseed` removes the guests of
demo games.

**Theme on the account**, stamped into `<html>` at render: no flash. The
battle page re-reads the palette when the device scheme changes.

**Winning is taking bases, tile by tile.** Chosen with the owner, replacing
an earlier Battlefront-style ticket system (no tickets, no bleed). Every base
tile has an owner (`state.baseOwners`, indexed by `baseTiles(map,
seatCount)`: the playing seats' bases flattened in seat order) and is
captured exactly like a command post, by the same `capture` helper in
`endRound`: a unit ending a round on it moves it one step towards its side
(theirs â†’ neutral â†’ yours). A captured base tile is a spawn tile for its new
owner; a lost one is not for the old. A side is out when it owns **no base
tiles and has no units** (`knockedOut`): checked at round end, and at once
when its last unit is shot. Command posts don't keep you in. A held post is a spawn tile on its own tile
only, not the tiles round it (the owner's call). Last side
standing wins; round 30 is a draw. Bases are small (4 tiles on the built-in
maps, at most 6 in the editor) so every tile matters.

**Balance numbers live in `tuning/`, as JSON, and every game snapshots
them.** The owner wanted to tinker with stats without code. `tuning.ts`
imports the files (so the browser bundle gets them too and `src/game` stays
free of `fs`) and checks them with a small hand-written checker that names
the file and field; a bad file stops the server at boot and fails `npm
test`. `UNITS` and `RULES` are the *active* tuning: plain objects whose
contents `withTuning(t, fn)` swaps around a synchronous rules call. Because
a game is its action log replayed, each game stores the tuning it was
created under (`games.rules_data`, like `map_data`); `games.ts` runs every
rules call for a game through `inGame(live, fn)`, and the battle page sends
the snapshot so the browser's hit chances match. Games from before snapshots
use the files. **Any new server-side call into `src/game` for a game must go
through `inGame`**, or it reads the files' numbers instead of the game's.
Use `scripts/simulate.ts` to see what a change does.

**Ten classes, as the owner specified them (tuning version 2).** Rifleman
(basic); engineer (unarmed, the only one that takes income sites); scout
(fast, far-sighted, weak); shotgun (wide arc, very accurate, damage falling
fast with distance: `spread`, plus `closeQuarters`); riot (unarmed, almost
never hit from the front: the shield cuts *hit chance*, and `minHitChance`
keeps it possible); sniper (`steady`: half accuracy after moving; `scoped`:
worse the closer the target, and a long narrow strip of extra sight);
commando (stealth, backstab, two shots, and a backstab from the next tile
kills outright); heavy (`explosive`: a shell bursts on the target's tile hit
or miss, hurting everyone round it, either side, not through walls);
healer (+5 to allies within 2 tiles, even under fire); officer (a rifleman
whose neighbours within 2 shoot better; `previewShot` needs the units list to
see it, so every caller passes the units it knows). Hits vary Â±10%
(`damageVariance`, a second roll) and the panel and reticles show the hit
chance and the damage range before firing.

**Games from before version 2 are upgraded, not refused.** Their snapshot has
no `version`: `upgradeSnapshot` keeps their numbers where the field still
exists and takes the rest (new classes, new fields, all traits) from the
files; `games.ts` converts their logged facings (eighths Ã— 45) and the
breacher to the shotgun as it replays. Their outcomes can still differ, since
the rules code changed under them.

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
time another update may have arrived; "Round 3 Â· Plan your moves" showed during
the attack phase. Each banner now checks the view it was made for is still
current.

**A single Playwright `mouse.move` jumps.** It delivers no move events in
between, so hover-driven drawing (the route preview) never sees it. Move in
steps in tests.

**The mobile audit's prose exemption was too broad.** It skipped any link
whose parent had long text, which included the whole header, so a 26px-tall
brand link passed. It now only exempts links inside `p`, `li`, `dd`, `.prose`.

**`[hidden]` did nothing on styled elements.** A class that sets `display`
beats the browser's own `[hidden] { display: none }`, so the battle tooltip
never hid (it showed stale health) and the editor showed seat buttons the map
did not have. One global `[hidden] { display: none !important }` fixes all of
them; keep it.

**Stopping a background `npx tsx` task can leave the server running.** The
wrapper dies, the node process keeps the port, and a "restarted" server fails
with EADDRINUSE while the old code goes on answering â€” so a suite tests the
old code and reports a 404 for a route that exists. Kill by the port's PID
(`netstat -ano`) and check the port is free before starting again.

**Fonts a fraction of a pixel tall render badly on canvas.** Labels on the
board are drawn in screen pixels, not tile units, for that reason.

**Fog at one pixel per tile looks like clouds.** Smoothing a 25Ã—17 image up to
the board smears each tile across its neighbours. Four pixels per tile softens
only the edges.

**Seeding writes straight to the database**, past the server's cache. Restart
the server after `seed`/`unseed`, or it serves games that no longer exist.

## Adding things

- **A unit class:** a file in `tuning/units/` (with every field, `shots` included), its import and `UNIT_KINDS`
  entry in `src/game/tuning.ts`, its kind in `UnitKind` (`types.ts`), a glyph,
  a shape and a size in `glyphs.ts` (a shape no other class uses), and if it has a new trait, the trait in `TRAITS`
  (`tuning.ts`), the rule where it applies (`combat.ts` or `rules.ts`), any
  number in `rules.json` (and the checker), plus `traitText` in `units.ts`.
  The shop, rules page, bot and panel pick it up from there.
- **A tuning number:** a field in `tuning/rules.json`, its type and range in
  `tuning.ts`, the rule reading `RULES.<field>`, and a row in
  `tuning/README.md`.
- **A built-in map:** a builder block in `src/game/maps.ts`, added to `MAPS`.
  Two-seat maps are rotated a half turn, four-seat maps must be square. Run
  `npm test`: it checks symmetry and runs `checkMap`. (Or make it in the
  editor and copy the saved JSON into a builder.)
- **A key:** a case in `onKey` (`src/client/game.ts`) built on the same
  functions as the matching tap or button, a line in `KEY_HELP`
  (`src/game/keys.ts`), and a step in `scripts/test-keys.ts`.
- **An editor tool:** a button in `editorPage` (`src/views/maps-view.ts`), its
  name in `Tool` and the right set in `src/client/editor.ts`, and its effect in
  `applyAt` built from the primitives so symmetry and undo come for free.
- **A rule change:** `src/game/rules.ts` or `combat.ts`, a test in
  `scripts/test-rules.ts`, then `npx tsx scripts/simulate.ts` to see it play.
  Stored games replay their logs under the new rules *code* (their numbers
  are snapshotted, their code is not); a replay that hits an action the new
  code refuses stops there with a warning rather than crash the game.

## Verification before calling a change done

1. `npm run typecheck`, `npm test`, and the simulator if rules or the bot moved.
2. Restart the server; `npm run unseed && npm run seed`; restart again.
3. `npm run test:flow`, `npm run test:editor`, `npm run test:keys`, `npm run test:guest`, `npm run audit:mobile`,
   `npm run shot` â€” and look at the images. All at zero warnings.
4. Update this file in the same change.

## Deployment

Live at **https://salient.91-99-202-188.sslip.io** since 2026-11-08, first
deployed by hand. GitHub Actions deploys every push to `main` once the
`DEPLOY_ENABLED` repository variable is `true`, the deploy key is on the
server and the repository is public (the server pulls anonymously). The path
is the playbook's, steps 1â€“7.

The first install could not clone: the repository was private, so GitHub
asked the server for a login. It went up as a `git bundle` copied over SSH,
with `origin` then pointed at GitHub. A bundle has no HEAD, so its clone
checks nothing out: `git checkout -B main origin/main` afterwards. `npm` puts
its cache in the app user's home, which is `/opt/salient`, hence `.npm/` and
`.cache/` in `.gitignore`.

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
