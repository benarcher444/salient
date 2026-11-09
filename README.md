# Salient

A turn-based tactics game for two to four players, in the browser.

Buy units onto your base. Capture command posts to deploy further forward,
and income sites to pay for more. Plan your moves in secret while everyone
else does the same; watch them play out together; then trade shots one unit
at a time. Fog of war hides everything your units can't see. Facing matters:
hit someone from the side or behind and it hurts more.

Play friends by sending a link, or play the computer. Design your own
battlefields in the map editor and play them straight away.

## The game in a minute

- **Take their base.** Each side starts with a small base. Base tiles are
  captured one at a time, like command posts: end a round on one and it turns
  neutral, end the next there and it's yours to deploy on. A side with no
  base tiles and no units left is out; the last one standing wins.
- **A round:** everyone **plans** at once (deploy units, give each a route and
  a facing) → everything **moves** together, step by step → players take turns
  **firing** one unit at a time → **upkeep**: captures, income, healing.
- **Eight unit classes:** rifleman, scout, engineer, heavy, sniper, riot,
  commando and breacher, each with its own cost, range, firing arc and trait.
- **The map:** walls block movement and sight; windows and low walls block
  movement but you can shoot through them; crates, low walls and woods give
  cover; rock blocks everything.

The full rules are on the game's **How to play** page. Every unit's stats and
the economy are plain JSON files in [`tuning/`](tuning/README.md), made to be
tinkered with.

## Running it

Needs Node 22 or newer.

```bash
npm install
cp env.example .env        # optional: every setting has a default
npm run seed               # demo accounts and a game in progress
npm start                  # http://localhost:3000
```

Sign in as `alex@demo.local` / `demopassword` (or `sam@…`, `empty@…`). To let
real people sign up, put their email addresses, one per line, in
`invites.txt`. With no such file, nobody can.

## Checking it works

```bash
npm run typecheck
npm test                         # the rules, exhaustively
npx tsx scripts/simulate.ts      # bots play each other: every game must finish
npm run test:flow                # two browsers play a real game (server running)
npm run test:editor              # the map editor in a real browser
npm run audit:mobile             # phone-size checks (server running)
npm run shot                     # screenshots of every page, light and dark
```

## How it's built

TypeScript on both sides: the rules in `src/game/` run on the server (the
authority) and in the browser (move previews and hit chances), so the two can
never disagree. Fastify serves the pages and a WebSocket per game; SQLite
stores each game as a log of actions that is replayed to rebuild it. The
battle is drawn on a canvas with procedural art, with no image files.
[`CLAUDE.md`](CLAUDE.md) has the decisions and the reasons behind them.

The original 2021 pygame prototype this grew out of is in `old_code/`.
