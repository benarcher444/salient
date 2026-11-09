# Tuning

Every number the game is balanced by lives in this folder, as plain JSON, so
you can tinker without touching code. One file per unit class in `units/`,
and `rules.json` for the economy, shooting and traits.

## Trying a change

1. Edit a file and save it. JSON is fussy: keep the quotes around names,
   no comma after the last item, and no comments.
2. See what it does to the balance without playing:

   ```bash
   npx tsx scripts/simulate.ts                         # bots play each other on every map
   npx tsx scripts/simulate.ts --map=crossroads --games=20
   ```

   It prints who won, how long games ran, how often shots hit and what the
   bots bought.
3. Restart the server (`npm start`) to play with it. The server checks every
   file when it starts and refuses to start if one is wrong, naming the file
   and the field, for example:
   `tuning/units/scout.json: "cost" is -5; it must be between 0 and 10000.`
   `npm test` runs the same check.
4. Commit and push: the live game picks it up on the next deploy.

**Games already started keep the numbers they started with.** A game is
stored as its list of moves and rebuilt by replaying them, so each game keeps
its own copy of these files from the moment it was created. Changing a
rifleman's damage changes new games only, never one in progress.

## `units/<class>.json`

| Field | What it means |
|---|---|
| `name` | Shown in the shop and the panel. |
| `role` | The one-line description on the shop card and the How to play page. |
| `cost` | Gold to deploy one. Whole number. |
| `hp` | Health. The unit dies at 0. Whole number. |
| `move` | How far it walks in a round, in tiles. A diagonal step costs 1.5, woods cost double. |
| `sight` | How far it sees, in tiles, all the way round. Walls and rock block sight. |
| `range` | The furthest it can shoot, in tiles. |
| `optimal` | Its best range. Past this, accuracy falls off steadily to half at `range`. Must not be more than `range`. |
| `accuracy` | Percent chance to hit at its best range in the open (cover and so on reduce it). |
| `damage` | Damage per hit, before facing, traits and critical hits. |
| `arc` | Width of its firing arc in degrees, centred on where it faces. 360 shoots all round. |
| `traits` | A list of special rules from the table below, e.g. `["armoured"]`, or `[]`. |

### Traits

| Trait | What it does | Its number in `rules.json` |
|---|---|---|
| `engineer` | Can capture income sites. | |
| `medic` | Allies standing next to it heal extra at round end. | `medicHeal` |
| `armoured` | Takes less damage from everything. | `traits.armouredDamage` |
| `shield` | Takes much less damage from shots that arrive from in front. | `traits.shieldFrontDamage` |
| `stealth` | Enemies only see it within a few tiles. | `traits.stealthRange` |
| `backstab` | Shots into an enemy's back hit far harder. | `traits.backstabMultiplier` |
| `steady` | Accuracy drops if it moved this round, and when the target is very close. | `traits.steadyPenalty`, `traits.steadyMinRange` |
| `closeQuarters` | Ignores cover when the target is close. | `traits.closeQuartersRange` |

Adding a brand new trait needs code (see `CLAUDE.md`); these files can give
any class any of the existing ones.

## `rules.json`

| Field | What it means |
|---|---|
| `startGold` | Gold each side starts with. |
| `baseIncome` | Gold every side gets at the end of every round. Income sites add their own value on top (set per site in the map). |
| `healPerRound` | Health a unit regains at round end if it wasn't hit that round. |
| `medicHeal` | Extra health for a unit next to a medic (an engineer) at round end. |
| `critChance` | Share of hits that are critical, from 0 to 1 (0.1 = one hit in ten). |
| `critMultiplier` | A critical hit's damage multiplier. |
| `roundLimit` | If nobody has won after this many rounds, the game is a draw. |
| `siteSight` | How far you see around base tiles and command posts you hold. |
| `minHitChance`, `maxHitChance` | Every shot's chance is kept between these percentages. |
| `coverFactor` | Hit chance is multiplied by this when the target is in cover (0.6 = 40% less likely). |
| `obstructionFactor` | Multiplied once for each thing partly in the way (up to three). |
| `flank.front`, `flank.side`, `flank.rear` | Damage multiplier by which side of the target the shot hits. |
| `traits.armouredDamage` | Armoured units take damage × this (0.8 = 20% less). |
| `traits.shieldFrontDamage` | Shield units take front damage × this (0.4 = 60% less). |
| `traits.backstabMultiplier` | A backstab unit's damage into a back is its `damage` × this (instead of `flank.rear`). |
| `traits.stealthRange` | Stealth units are only seen by enemies within this many tiles (with a clear line). |
| `traits.steadyPenalty` | Steady units' hit chance × this if they moved, or the target is too close. |
| `traits.steadyMinRange` | "Too close" for a steady unit, in tiles. |
| `traits.closeQuartersRange` | Close-quarters units ignore cover within this many tiles. |
