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
| `optimal` | Its best range. Past this, accuracy falls off steadily to `longRangeAccuracy` (in `rules.json`) at `range`. Must not be more than `range`. |
| `accuracy` | Percent chance to hit at its best range in the open (cover and so on reduce it). |
| `damage` | Damage per hit, before facing, traits and critical hits. A hit does this ± `damageVariance`. |
| `arc` | Width of its firing arc in degrees, centred on where it faces. 360 shoots all round. |
| `shots` | Shots it can take in its attack turn. 1 for most; the commando has 2, and can switch targets between them. |
| `traits` | A list of special rules from the table below, e.g. `["stealth", "backstab"]`, or `[]`. |

An `unarmed` unit ignores `range`, `optimal`, `accuracy`, `damage`, `arc` and
`shots`; they are kept at 0 (or 1) only because every file has every field.

### Traits

| Trait | What it does | Its numbers in `rules.json` |
|---|---|---|
| `unarmed` | Can't shoot at all (the engineer and the riot shield). | |
| `engineer` | Can capture income sites. | |
| `medic` | Allies within a few tiles heal extra at round end, even if they were hit that round. | `medicHeal`, `medicRange` |
| `command` | Allies within a few tiles (not itself) shoot more accurately and harder. | `traits.commandRange`, `traits.commandAccuracy`, `traits.commandDamage` |
| `shield` | Shots that arrive from in front are much less likely to hit. Never quite impossible: `minHitChance` still applies. | `traits.shieldFrontHit` |
| `stealth` | Enemies only see it within a few tiles. | `traits.stealthRange` |
| `backstab` | Shots into an enemy's back hit far harder, and a hit from right next to its back kills outright. | `traits.backstabMultiplier`, `traits.backstabFatalRange` |
| `steady` | Accuracy drops if it moved this round (the board shows a tripod while it hasn't). | `traits.steadyPenalty` |
| `scoped` | Accuracy drops the closer the target is than `optimal`; also sees a long, narrow strip straight ahead. | `traits.scopedCloseAccuracy`, `traits.scopeSight`, `traits.scopeArc` |
| `closeQuarters` | Ignores cover when the target is close. | `traits.closeQuartersRange` |
| `spread` | Damage falls away with distance: full next to the target, down to a fraction at `range`. | `traits.spreadFarDamage` |
| `explosive` | Every shot bursts on the target's tile: a hit does full damage to the target and blast damage to every unit on the tiles round it (either side, not through walls); a miss does blast damage to the target too. | `traits.splashDamage` |
| `armoured` | Takes less damage from everything. (No class has it at the moment.) | `traits.armouredDamage` |

Adding a brand new trait needs code (see `CLAUDE.md`); these files can give
any class any of the existing ones.

## `rules.json`

| Field | What it means |
|---|---|
| `startGold` | Gold each side starts with. |
| `baseIncome` | Gold every side gets at the end of every round. Income sites add their own value on top (set per site in the map). |
| `healPerRound` | Health a unit regains at round end if it wasn't hit that round. |
| `medicHeal` | Extra health at round end for a unit near a medic (the healer), hit or not. |
| `medicRange` | How near, in tiles, counting diagonals as one (2 = the 5×5 square round the healer). |
| `critChance` | Share of hits that are critical, from 0 to 1 (0.1 = one hit in ten). |
| `critMultiplier` | A critical hit's damage multiplier. |
| `damageVariance` | How much a hit's damage varies either way, from 0 to 1 (0.1 = 10% less to 10% more). |
| `roundLimit` | If nobody has won after this many rounds, the game is a draw. 0 means no limit: a game ends only when one side is left. |
| `baseCaptureRounds` | Rounds a unit must hold an enemy base tile to make it neutral, and the same again to make it its own side's. Whole number. |
| `engineerBaseCaptureRounds` | The same for an engineer (1 = a step every round). |
| `siteSight` | How far you see around base tiles and command posts you hold. |
| `minHitChance`, `maxHitChance` | Every shot's chance is kept between these percentages. |
| `coverFactor` | Hit chance is multiplied by this when the target is in cover (0.7 = 30% less likely). |
| `obstructionFactor` | Multiplied once for each thing partly in the way (up to three). |
| `longRangeAccuracy` | Accuracy at a unit's maximum `range`, as a share of its accuracy at `optimal` (0.65 = 35% less). It falls steadily between the two. |
| `flank.front`, `flank.side`, `flank.rear` | Damage multiplier by which side of the target the shot hits. |
| `traits.shieldFrontHit` | Shield units are hit from the front this share as often (0.1 = a tenth). |
| `traits.backstabMultiplier` | A backstab unit's damage into a back is its `damage` × this (instead of `flank.rear`). |
| `traits.backstabFatalRange` | From this close behind (in tiles, diagonals counting as one), a backstab hit kills outright. |
| `traits.stealthRange` | Stealth units are only seen by enemies within this many tiles (with a clear line). |
| `traits.steadyPenalty` | Steady units' hit chance × this if they moved this round. |
| `traits.scopedCloseAccuracy` | A scoped unit's accuracy against a target right next to it, as a share; it rises steadily to full at its `optimal` range. |
| `traits.scopeSight` | How far a scope's strip of sight reaches, in tiles. |
| `traits.scopeArc` | How wide that strip is, in degrees. |
| `traits.closeQuartersRange` | Close-quarters units ignore cover within this many tiles. |
| `traits.spreadFarDamage` | A spread unit's damage at its maximum range, as a share of full (0.3 = 30%). |
| `traits.splashDamage` | An explosive's blast damage, as a share of its `damage` (0.4 = 40%). |
| `traits.commandRange` | How near an officer must be to help, in tiles (diagonals counting as one). |
| `traits.commandAccuracy` | Hit chance × this with an officer near. |
| `traits.commandDamage` | Damage × this with an officer near. |
| `traits.armouredDamage` | Armoured units take damage × this (0.8 = 20% less). |
