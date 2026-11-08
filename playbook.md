# Playbook: building an app to this standard

You are an AI coding agent. This file is the whole brief. It is the distilled
practice of a working, deployed web app — what was decided, what went wrong on
the way, and what the owner expects — written so you can reach the same standard
in a new repository without having seen that one.

**Read it top to bottom before writing any code.** Then build what the owner
asked for, in the order set out in "The first hour".

## How to use this file

- Keep it in the repository root as `CLAUDE.md`, so every future session loads
  it automatically. If you prefer to keep this reference intact, name it
  `PLAYBOOK.md` and have a two-line `CLAUDE.md` point at it.
- It describes **defaults, with reasons**. Where the app the owner wants needs
  something different, deviate — and write down what you changed and why, in
  the same change. A default you cannot justify for this app is not a default
  worth keeping.
- Everything here has been used in production on a small server. None of it is
  aspirational.
- As you build, this file becomes the app's own handbook: add its decisions,
  its traps and its verification commands as you go. See "Keep the handbook
  current".
- **If the app has an AI feature, read `AI-PLAYBOOK.md` as well**, before
  writing any of it. It is the companion to this file and covers only that:
  the provider abstraction, the free test stand-in that makes those features
  testable at all, the current API shape, the errors worth distinguishing, and
  how not to leak a key or run up a bill. Nothing in this file repeats it. If
  that file did not come with this one, ask the owner for it rather than
  improvising — most of it is things that are not guessable.

What is in it:

| Section | What it settles |
|---|---|
| The bar | The standard a change has to meet before it counts as done |
| The first hour | The order to do things in, from empty folder to a deployed page |
| Working agreements | The owner's standing instructions |
| Stack, layout, config and code standards | What to build it with, where files go, how to write them |
| Visual design, theming and mobile | Tokens, light and dark, components, and the phone |
| Accounts, and hygiene for a public server | Sign-in, and what the open internet demands |
| Verification and data integrity | How to prove it works, and the rules that stop numbers drifting |
| GitHub, CI and deployment | Repo, pipeline, server, HTTPS, backups — the whole path to live |
| Keep the handbook current | What to write down, and when |
| Before you call anything done | The checklist |

## The bar

The owner is not asking for a prototype. These are the marks of the standard
expected, and each is enforceable:

- **Every page works on a phone**, at 390px, first time — not after a later
  "mobile pass".
- **Light and dark are both first-class**, with no flash of the wrong palette
  on load.
- **Zero console errors and zero horizontal overflow**, on every page, at both
  widths, in both themes, proven by a screenshot pass rather than asserted.
- **Nothing that records data can drift.** Counters are rebuilt from an event
  log, never incremented in place; anything that depends on today's date is
  derived, never stored.
- **It deploys itself.** A push to `main` runs the checks and updates the live
  site, with a database backup taken first and a health check after.
- **It is documented as it is built.** The handbook is updated in the same
  change that makes it true, not afterwards.
- **Claims are verified.** A 200 response is not evidence that a page is right;
  a screenshot is. If something fails, say so plainly, with the output.

## The first hour

Do these in order. Do not start writing features before step 4.

1. **Agree the shape in one paragraph.** Write, in the handbook, the app's
   purpose in one sentence, who signs in, the three or four nouns it stores,
   and the first screen. Ambiguity resolved now is cheap; a data model changed
   in week two is not.
2. **Scaffold the repository** — the layout in "Repo layout", `package.json`
   with the script ladder, `tsconfig.json`, `.gitignore`, `env.example`,
   `README.md` (how to run it) and this file as `CLAUDE.md`.
3. **Create the GitHub repository and push an empty-but-running skeleton**, with
   the CI workflow in place from the first commit. See "GitHub, CI and
   deployment", step 1. Green CI on commit one is the habit that keeps `main`
   deployable.
4. **Build the smallest thing that runs**: a server that boots, one page that
   renders through the layout with the design tokens in place, sign-in if the
   app has accounts, and the database schema with its first migration.
5. **Stand it up on the server before it is finished**, on a free hostname, as
   soon as it has one working page. See "GitHub, CI and deployment", steps 5-6.
   An app that is deployed on day one stays deployable; one that waits until
   it is "ready" finds out too late what production does differently.
6. **Then build the features**, verifying each as "Verification" describes.

## Working agreements

These are the owner's standing instructions. They are not negotiable defaults;
they are how the work is judged.

- **Never commit a secret.** Keys live in `.env`, which is gitignored. The
  template is `env.example` — no leading dot, so the `.env*` ignore rule does
  not swallow it. If a key is ever committed, say so immediately and rotate it.
- **Back up before anything destructive**, and make the destructive script take
  its own backup too. Scripts that change data are dry-run by default and need
  an explicit `--apply`.
- **Fix a data bug; do not write it up and leave it.** Anything that miscounts
  what the app records gets fixed straight away, with a regression test, or is
  raised plainly with the owner. A known miscount left in place as a documented
  quirk corrupts every number downstream while it waits.
- **Verify visually.** For UI work that means looking at real screenshots, not
  asserting a 200 response.
- **Say plainly when something was your error.** Distinguish a broken feature
  from a bad test, and report which it was.
- **Keep the handbook current**, unprompted, as part of the change that makes
  it true.
- **Ask when a decision is the owner's.** Which provider, which domain, what
  something should be called, whether to spend money: those are theirs. Pick
  sensible defaults for everything else and say what you picked.


---

## Stack, layout, config and code standards

### The default stack

Unless the app idea demands otherwise, build it like this. Each choice is a
constraint, and the reason is what tells you when to break it.

| Piece | Choice | Why |
|---|---|---|
| Runtime | Node 20+, ESM (`"type": "module"`) | On every host, no runtime to install beyond Node. |
| Language | TypeScript, `strict` plus `noUncheckedIndexedAccess` | The compiler is the only reviewer you get for free. The extra flag catches the `arr[0]` that is really `T \| undefined`. |
| Execution | `tsx` run directly — no build step | `npm start` is `tsx src/server.ts`. There is no `dist/` to go stale, no build to forget before a restart, and a deploy is pull-install-restart. |
| HTTP | Fastify | Small, fast, first-party cookie/formbody/static plugins, and logging (pino) built in rather than bolted on. |
| Storage | SQLite via better-sqlite3, Drizzle as the ORM | One file, no database process, no connection pool, nothing to administer. |
| HTML | Server-rendered template strings | The server already holds the data. Rendering it there means no client state to keep in sync and no hydration. |
| CSS / JS | Plain CSS and vanilla ES modules in `public/` | No bundler, so nothing to compile, nothing to fetch at page load, and a change to `public/` is live on reload without a restart. |
| Validation | zod at every request boundary | A typed body is a lie until something checks it. |
| Charts, if any | Hand-written inline SVG | No library to fetch or bundle; colours come from CSS custom properties so themes are handled by the stylesheet, not duplicated in JS. |

The through-line: **it has to run unattended on a small VPS or a single-board
machine, and keep working offline.** Every moving part is one more thing that
can fail at 2 a.m. on a machine you are not sitting at.

**`tsx` belongs in `dependencies`, not `devDependencies`,** because production
runs through it. Putting it in dev means `npm ci --omit=dev` produces a server
that cannot start.

Why not the obvious alternatives:

- **Not Prisma.** Its query engine ships as a native binary, which is a
  recurring problem on ARM and any less-common platform. Drizzle is TypeScript
  over a driver.
- **Not Postgres from day one.** With a Drizzle schema, moving later is a driver
  change, not a rewrite. Write the schema so that stays true: no SQLite-only
  types or functions in business logic.
- **Not React/Next.** A build step, a bundler, a hydration model and a node
  process twice the size, for pages that are mostly text the server already has.
- **Not a CSS framework.** A stylesheet with custom properties is smaller than
  the configuration file a framework needs.

**When deviating is right.** Use a real client framework if the app's core is a
genuinely stateful canvas — a drawing tool, a spreadsheet, a live multi-user
editor — where every interaction would otherwise be a round trip. Use Postgres
from the start if you know you need concurrent writers across processes, or
full-text/JSON querying SQLite does badly. Add a bundler only when you actually
have a dependency that cannot be loaded as a plain module. In each case, say in
the project's own notes which constraint forced it; the next agent needs to know
the default was weighed, not forgotten.

### Repo layout

```
src/
  server.ts          Fastify setup, plugin and route registration, listen. Imports ./env.js FIRST.
  env.ts             Loads .env. Nothing else. Must be the first import anywhere.
  context.ts         Per-request context: who is signed in, what they selected. Query-param helpers.
  auth.ts            Password hashing, session issue/lookup/prune.
  <domain>.ts        One file per domain concept (the core rules, pure where possible).
  db/
    schema.ts        Drizzle tables, indexes, inferred row types.
    index.ts         The connection and its pragmas. Exports `db`.
    migrate.ts       Applies migrations at startup.
  routes/            One file per area of the site. HTTP in, HTML or JSON out. No business rules.
  views/
    layout.ts        The page shell, escaping helpers, nav, theme.
    components.ts    Shared fragments and the single source of labels/colours/icons.
    <page>-view.ts   Markup for one page, when a route file would otherwise bloat.
public/              Served at /static. Stylesheet and browser modules. No build step.
scripts/             Every tsx entry point that is not the server: tests, seed, screenshots, one-off repairs.
drizzle/             Generated migration SQL. Committed.
deploy/              systemd unit, reverse-proxy config, deploy script.
data/                The database and its backups. Gitignored.
.github/workflows/   Typecheck plus the server-free suites on every push.
env.example          Committed template. No leading dot.
README.md            How to run it, what it does, the command table.
CLAUDE.md            Decisions, traps, working agreements. Kept current as part of each change.
```

Rules that keep the tree honest:

- **A file has one job.** `routes/` parses requests and renders; the rules live
  in their own module and are importable by a test script without a server.
  When a route file passes ~400 lines, the markup moves to `views/`.
- **One place for each fact.** Mode names, colours, icons, thresholds,
  default option lists: export them from one module and derive everything else.
  A `mode === "audio"` ternary copied into six pages is how the seventh gets
  missed.
- **`scripts/` is the test runner.** Plain `tsx` scripts that exit non-zero on
  failure, wired into `package.json` as `test:<thing>`, with a `test:all` that
  chains them. No test framework needed, and each one is runnable alone.

### Config and secrets

- **`.env` is gitignored** (`.env`, `.env.*`) and holds every secret.
- **`env.example` is committed, with no leading dot** — deliberately, so the
  `.env*` ignore rule cannot swallow it. Name it `.env.example` and sooner or
  later it stops being tracked and nobody can tell what the app needs. It
  carries a copy command at the top, every variable with a comment, and secrets
  commented out.
- **Never commit:** API keys, the database or its `-wal`/`-shm` sidecars, any
  file of personal data (an invite list, an export), screenshots of real data,
  password hashes. If a key ever reaches a remote, rotate it; removing the
  commit does not unpublish it.
- Read config from `process.env` with a default beside it
  (`Number(process.env.PORT ?? 3000)`), so a fresh clone runs without a `.env`.
- Deployed, the secrets come from the service manager (systemd's
  `EnvironmentFile`), not a file in the repo, so `.env` being absent must be
  fine.

**The trap: `.env` has to load before any import reads it.** ES imports are
hoisted, so this does not work:

```ts
process.loadEnvFile();          // runs third
import { db } from "./db/index.js";  // evaluated first — already read DATABASE_PATH
```

Every imported module evaluates before the importing module's body runs. Any
module that reads `process.env` at import time — a database path, a provider
choice — sees the unset value, silently. The fix is a module whose only job is
loading, imported first:

```ts
// src/env.ts
try {
  process.loadEnvFile();
} catch {
  // No .env — variables come from the environment (systemd's EnvironmentFile).
}

// src/server.ts — first line, before every other import
import "./env.js";
```

Keep the comment saying why, or someone will "tidy" the stray import away.
Standalone scripts do not go through `server.ts`, so each one that needs config
imports `env.js` itself.

### Code-writing standards

**Comments explain why, and name the trap.** The code already says what it
does. A comment earns its place by recording a decision, a constraint, or the
bug that made the line look odd:

```ts
// Believe X-Forwarded-For only from a proxy on this machine. Then request.ip is
// the visitor, for rate limiting, and request.protocol is https, for the Secure
// cookie. The same headers from anyone else are ignored.
trustProxy: "127.0.0.1,::1",
```

```ts
/**
 * Read a positive integer from a query string, treating absent, empty and
 * non-numeric values alike as "not given".
 *
 * Written because `Number("")` is `0`, not `NaN`, and `Number.isInteger(0)` is
 * true — so an empty `?type=` from a select whose default option has an empty
 * value read as a real id of 0 and filtered everything away.
 */
```

Write `// Increment the counter` above `count++` and you have added noise. Delete
the comment when you delete the reason.

**Naming.** Say what a thing is in the domain's own words, in full:
`loadScoredRows`, `requireContext`, `optionalId`. Booleans read as assertions
(`hasRecords`, `providerConfigured`). No Hungarian notation, no `utils.ts` — a module
named for what it holds is findable; a bag of helpers is not.

**No cleverness.** Prefer the plain loop to the chained reduce. Prefer two named
functions to one with a mode flag. Derive values rather than caching them: if a
figure depends on today's date or on a log of events, compute it on read and
rebuild it from the log rather than incrementing a stored copy — an increment
that goes wrong once stays wrong for ever, and a stored derived value is stale
by definition.

**Error handling.** Validate at the boundary and answer with a code, not a
stack:

```ts
const parsed = z.object({ itemId: z.number().int().positive() }).safeParse(request.body);
if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
```

Check ownership on every id that arrived from a client, against that user's own
rows, so a guessed id resolves to nothing rather than leaking another account's
data. Give each distinct failure its own code and its own message — a bad key, a
missing key, an exhausted account and a busy upstream look alike in a provider's
HTTP status and need different words to the user. Catch only what you can
handle, and put the reason in the empty `catch`. An unexpected throw should log
and return a 500, never a blank page.

**Escape every interpolated value.** Server-rendered template strings mean XSS
is one forgotten `esc()` away. Have one `esc()` for HTML and one `jsonScript()`
for a value embedded in a `<script>` (which must escape `<`, `>` and `&` as
well, or `</script>` inside a string closes the tag), and route everything
through them.

**Passing data to browser JS.** Emit a classic `<script>` for the data, then a
deferred module for the code:

```html
<script>window.APP_DATA = {"id":7};</script>
<script type="module" src="/static/page.js"></script>
```

A module script is deferred, and its static `import`s are hoisted above
everything else, so a `<script type="module">` that assigns `window.APP_DATA`
and then imports runs the import *first* — the imported module reads
`undefined`. The split is the fix, not a redundancy. Put a comment on it; it
looks like something to simplify.

### npm and install traps

- **Native modules need their install scripts approved.** npm 11 refuses to run
  them by default. List them in `package.json` so a clean `npm ci` builds them:

  ```json
  "allowScripts": {
    "better-sqlite3@13.0.3": true,
    "argon2@0.45.1": true,
    "esbuild@0.25.12": true
  }
  ```

  `esbuild` is in that list because `tsx` runs on it: without its binary,
  nothing TypeScript runs at all. Add a new entry with
  `npm install-scripts approve <pkg>` whenever a dependency with an install
  script arrives — the symptom otherwise is a server that cannot start, with no
  obvious cause. Keep `build-essential` and `python3` on the deploy host in case
  no prebuilt binary matches it.
- **Never run two `npm install`s in one project at the same time.** They clobber
  each other and can leave `package.json` with no dependencies at all while
  still exiting 0. If an install is running in the background, wait for it.
- **`npm ci --omit=dev` in production** — which is why anything production needs
  belongs in `dependencies`.
- Commit the lockfile. Set `"private": true` unless you intend to publish.

---

## Visual design, theming and mobile

One hand-written stylesheet, no framework, no bundler. The whole visual system is
a block of custom properties at the top of `public/styles.css` and component
classes below it. Everything else — charts, inline styles, JavaScript that paints
a bar — reads those properties rather than naming a colour.

### Design tokens

**Light is the base, declared in `:root`. Dark redefines only what changes.** No
colour's sole definition lives inside a media query; if it did, a forced-light
user on a dark device would get an undefined variable and an unstyled element.

```css
:root {
  color-scheme: light;
  --bg: #f7f6f3;              /* page behind everything */
  --surface: #ffffff;         /* cards, bars, popovers */
  --surface-2: #fbfaf8;       /* nested panel inside a card */
  --surface-sunken: #f1efeb;  /* wells, track behind a progress bar */
  --border: #e5e1da;  --border-strong: #d4cfc5;   /* inputs, buttons */

  /* Three text shades: muted for labels and captions, faint for metadata */
  --text: #1c1a17;  --text-muted: #6f6a61;  --text-faint: #9c968b;

  --accent: #5b4bd6;  --accent-hover: #4c3dc0;  --on-accent: #ffffff;
  --accent-soft: #eeecfc;  --accent-border: #cfc9f5;

  --shadow-sm: 0 1px 2px rgb(28 26 23 / 0.05);  /* plus --shadow, --shadow-lg */
  --radius-sm: 7px; --radius: 11px; --radius-lg: 16px; --radius-xl: 22px;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --serif: ui-serif, Georgia, "Iowan Old Style", serif;  /* plus --mono */
  --sidebar-w: 244px; --content-max: 1080px;
}
```

Dark is declared **twice**, and both copies are needed:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; --bg: #131217; /* … */ }
}
:root[data-theme="dark"] { color-scheme: dark; --bg: #131217; /* … */ }
```

The media query serves "follow the device" and must stand down when the account
has forced light — hence `:not([data-theme="light"])`. The attribute selector
serves "always dark" on a light device. Duplication is the price of handling both
without JavaScript; keep the blocks adjacent so they are edited together.

Alongside the neutrals sit **semantic tokens**, one per state your domain has:
a text shade, a soft background and a border, so a badge, an alert and a chart
series all come from the same triple.

```css
--ok: #16855f;     --ok-soft: #e2f4ed;     --ok-border: #b3e0ce;
--warn: #b45309;   --warn-fill: #f59e0b;   --warn-soft: #fef3e2; --warn-border: #f7d7a1;
--danger: #c0392f; --danger-soft: #fceceb; --danger-border: #f0c4c0;
```

Note `--warn` and `--warn-fill`: the shade readable as text on white is too dark
for a bar or a dot, the vivid one unreadable as text, and one token for both jobs
produced a muddy mustard. Split any colour that has to do both jobs.

**Why tokens rather than hard-coded colours.** The stylesheet handles both
themes, so no page, template or script branches on theme; server-rendered inline
SVG charts emit `fill="var(--series-a)"` and recolour themselves; and a palette
correction is one edit rather than a grep.

### Theming

**The theme is saved on the account, not in the browser** (`users.theme`: `auto`
| `light` | `dark`). Per-device storage means a laptop set to dark and a phone
still light, with no way to reconcile them; one choice per person holds wherever
they sign in.

**Stamp it while building the page.** The layout function writes the attribute
into the `<html>` tag it is already generating, so the right palette is in force
at first paint:

```ts
const themeAttr = (t: Theme) => (t === "auto" ? "" : ` data-theme="${t}"`);
const scheme = (t: Theme) => (t === "auto" ? "light dark" : t);

return `<!doctype html>
<html lang="en"${themeAttr(theme)}>
<head><meta name="color-scheme" content="${scheme(theme)}">…`;
```

A client script that applies the theme after load flashes the wrong palette on
every navigation; do not use one. `color-scheme` (the meta and the property on
`:root`) makes the browser's own furniture — scrollbars, form controls, the
`<select>` dropdown — match, or a dark page keeps white scrollbars.

The switch is a three-button form posting to `/preferences/theme`, `aria-pressed`
on the current choice. **Redirect back only to a path on this site**: validate
the `Referer`'s host, and send a foreign one home.

### The dark-mode trap

Deriving a state colour by mixing it toward the surface looks right in light mode
and inverts in dark, because there the mix *darkens*: the shade meant to read as
"further along" comes out fainter than the one meant as "just started". Same for
`opacity`, `filter: brightness()` and `color-mix(… var(--surface))`.

**The rule: any colour that encodes state gets its own explicit token in each
theme, and the ordering between related states is stated, not computed:**

```css
:root       { --state-high: #0f6e4d; --state-mid: #5fbf97; }  /* darker = further on */
:root[data-theme="dark"] { --state-high: #1d8a63; --state-mid: #5fd6a9; }
```

Decorative mixing — a hover tint, a card's inner panel — is fine; nothing is read
from it. Keep distinct categories far apart in hue too: two adjacent blues are
indistinguishable in a 9px legend swatch, so move the second series to another
hue family rather than nudging it.

### Component conventions

- **`.card`** — `--surface`, 1px `--border`, `--radius-lg`, `--shadow-sm`, with
  `.card-head` (title, `.sub`, right-aligned wrapping actions) and `.card-body`;
  `.card-body.tight` drops padding for a flush table.
- **`.btn`** — inline-flex, so an icon and a label centre together. Variants
  (`-primary`, `-ghost`, `-danger`, `-lg`, `-sm`) change only colour or padding;
  the base class owns the geometry. **`.pill`** is the same idea for a state
  badge, built from one semantic triple: soft background, border, text.
- **`.empty`** — centred icon tile, heading, one sentence, a button. It **names
  the concrete next action**; stating the problem alone leaves the reader stuck.
- **`pageHead({ title, sub?, actions? })`** — one function, so every page's
  heading block shares its spacing and wrap behaviour.
- **`.table-wrap { overflow-x: auto }`** around `table.data`: small uppercase
  headers on `--surface-2`, row hover, `.num` with `tabular-nums`.

**Map a concept to its label, colour and icon in one place**, not a ternary in
each template:

```ts
export const KIND_LABEL:  Record<Kind, string> = { alpha: "Alpha", beta: "Beta" };
export const KIND_COLOUR: Record<Kind, string> = { alpha: "var(--accent)", beta: "var(--series-b)" };
export const KIND_ICON:   Record<Kind, string> = { alpha: icons.pen,       beta: icons.ear };
```

When a third or fourth variant arrives, these three lines are the whole visual
change; `kind === "beta" ? …` across nine templates is nine silent omissions.
Keep a handbook note listing every file a new variant touches. Icons likewise
come from one object of inline SVG (`viewBox="0 0 24 24"`, `fill="none"`,
`stroke="currentColor"`, round caps), sized per context in CSS: they inherit
colour, need no request and cannot fail to load.

### Mobile

Treat the phone as the primary target — it is where the app is actually used.

- **The sidebar is desktop-only.** Below 860px the grid collapses to one column,
  the sidebar is hidden and a **fixed bottom nav** (`.mobile-bar`) takes over.
  Anything that lived only in the sidebar — an account switcher, a scope picker,
  the theme switch — then has no route to it at all; give it a Settings tab.
- **Pad the content for the bar.** `main { padding: 18px 16px 88px }` against a
  ~64px bar — 16px gutters and clearance — plus
  `calc(6px + env(safe-area-inset-bottom))` on the bar for the home-indicator
  inset. Without the clearance the last control on each page hides under it.
- **44px touch targets.** `.btn`, `.input`, `.select` and checkbox labels get
  `min-height: 44px` at phone widths; checkbox boxes go to 20px, wrapped in a
  `<label>` so the label is the target. A row-level link gets `display: block;
  padding-block: 13px`, so the cell height is tappable, not the 19px of text.
- **16px minimum on anything you type into.** iOS Safari zooms the page when a
  focused field's font-size is below 16px and leaves you scrolled sideways; 16px
  exactly is the threshold. A fix, not a preference — set it on `.input`,
  `.select`, `textarea` and any bespoke field in the phone media query.
- **`min-width: 0` on grid and flex children.** They default to `min-width: auto`
  and refuse to shrink below their content, so a wide table's own `overflow-x`
  never engages and the *page* scrolls instead. Set it on every layout primitive.
- **Tables hide their right-hand columns**, where the action buttons are. At
  phone width, `display: none` the merely informative ones, and tighten
  `padding-inline`.
- **No horizontal page scroll, ever.** Watch `repeat(auto-fit, minmax(Xpx, 1fr))`:
  at 190px two columns plus the gap exceed a 390px phone's content width; 170px
  fits. Long unbroken strings (a path, a URL) need `overflow-wrap: anywhere`.
- **Turn off autofill and autocapitalisation on ordinary text fields.** A phone
  offers passwords, cards and addresses above the keyboard, and capitalises the
  first letter, on any field it cannot classify. One constant, spread into each:

  ```ts
  export const NO_AUTOFILL =
    'autocomplete="off" autocapitalize="none" data-1p-ignore ' +
    'data-lpignore="true" data-bwignore data-form-type="other"';
  ```

  `autocomplete="off"` alone is not honoured everywhere, hence the password
  managers' own opt-outs. Be honest about the limit: none of these suppress
  Chrome's keyboard accessory bar on Android, and no page attribute does, so
  establish the device and browser before adding attributes blind.
- **`-webkit-text-size-adjust: 100%`** on `html`, so rotating does not reflow
  type; and `prefers-reduced-motion` kills every transition and animation.

A trap: `fullPage` screenshots misplace `position: fixed`, so the bottom nav
appears to float mid-page. Verify it at a fixed viewport.

### An automated mobile audit

Screenshots show none of the above. Write `scripts/audit-mobile.ts`: Playwright,
a 390x844 viewport with `isMobile` and `hasTouch`, signed in as the seeded demo
account, walking every page and exiting non-zero on any finding. Measured in one
`page.evaluate` per page:

| Check | Why |
|---|---|
| Any `input`/`select`/`textarea` with computed font-size < 16px | iOS zooms on focus. Skip `checkbox`, `radio`, `hidden`, `submit`, `button`, `range` — they never trigger it, so they are false positives. |
| Any `a`, `button`, `[role=button]` or checkbox whose box is under ~44px | The accessibility floor, and these are tapped repeatedly. Measure `el.closest("label") ?? el`, since a checkbox is tapped via its label. Skip links inside prose — if the parent's text is meaningfully longer than the link's, it is read, not aimed at, and padding it to 44px would wreck the paragraph. Skip the nav bar and measure it separately. |
| `documentElement.scrollWidth > innerWidth + 1` | Horizontal page scroll. |
| Any `.table-wrap` whose `scrollWidth > clientWidth` | The table is hiding its rightmost columns behind a sideways scroll. |
| Bottom-nav height vs. `main`'s `padding-bottom` | Content trapped behind the fixed nav. |

Then drive one real interactive flow at phone size: start it, wait for the input,
assert the field's font size, the primary button's height and whether the whole
card fits above the fold. Layout checks pass on pages nobody can use.

Two implementation notes. Keep **named inner functions out of `page.evaluate`**:
`tsx` compiles with esbuild's `keepNames`, which injects a `__name` helper the
page does not have, and one named arrow makes the whole call throw. And cap the
reported targets per page (say six), or one bad rule buries everything else. Run
the audit alongside a screenshot pass that flags console errors and horizontal
overflow at both widths and both themes; keep all three at zero.

---

## Accounts, and hygiene for a public server

Skip this section only if the app genuinely has no accounts. If it has even one,
build all of it now: retrofitting sign-in across routes written without a user
is a rewrite.

### The shape

- **Email and password, with a session cookie, hashed with argon2id.** No
  third-party identity provider: it works offline, adds no dependency, and
  costs nothing. Hang **every table off `user_id`** from the first migration,
  and OAuth later becomes additive rather than a migration of all the data.
- **The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` exactly when
  the request arrived over HTTPS** — not unconditionally, or the app stops
  working over plain HTTP on a local network, which is where you will develop
  it.
- **Trust the proxy on loopback only** (`trustProxy: "127.0.0.1,::1"` in
  Fastify, or the equivalent). Then `request.ip` is the visitor rather than the
  reverse proxy — which is what rate limiting depends on — and
  `request.protocol` is `https`. Trusting every hop lets a visitor forge both.
- **Passwords cannot be recovered, only replaced.** Ship a
  `scripts/set-password.ts` on day one: being locked out of your own install
  otherwise has no remedy but editing the database by hand.

### Rules that keep it safe on the open internet

The repository may be public and the site reachable from anywhere. Assume both.

- **Sign-up by invitation** if the app is personal. A gitignored list file at
  the root, read on **every request** so edits apply without a restart, and
  **failing closed when missing** — an absent list must let nobody in, not
  everybody. Keep real addresses out of git; ship no template containing them.
- **Lock an account after five wrong passwords**, and provide
  `npm run unlock -- <email>`. Know the trade-off and say it out loud: anyone
  who knows an address can lock it, and unlocking needs a shell on the server.
  A timed lock is the alternative if that ever bites.
- **Rate-limit by address in memory** — a handful of sign-ins per quarter hour,
  fewer sign-ups per hour. argon2 is deliberately slow, so a flood of attempts
  is a CPU attack as much as a guessing one. **Exempt loopback**, or your own
  test suites will lock themselves out.
- **Check ownership on every id that arrives from a client**, against that
  user's own rows, so a guessed id resolves to nothing rather than leaking
  another account's data.
- **The client may assert only what it is designed to assert.** If a request
  carries a verdict the server would normally compute — "I got this right",
  "mark this as done" — honour it for exactly the one case it was built for and
  reject it everywhere else, and have a test that proves a crafted request
  cannot file it under something else.
- **`HOST=127.0.0.1` on the server**, always. Binding `0.0.0.0` there puts the
  app on the public internet beside the reverse proxy, bypassing HTTPS and the
  security headers. `0.0.0.0` is for your own machine, so a phone on the same
  Wi-Fi can reach it.
- **Never log a secret, a password or a token**, and never print one into a
  terminal that may be pasted into an issue.

---

## Verification and data integrity

### What "done" means

A change is done when there is evidence it works, and the evidence is in the
transcript.

**A 200 response is not verification.** The server answering proves routing and
templating did not throw. It says nothing about whether the right numbers were
rendered, whether the button does anything, or whether the page is usable on a
phone. Assert on what the user would look at.

**UI work is verified by looking at real screenshots**, not by reasoning about
the CSS. A layout bug is obvious in a picture and invisible in a status code.

**Report failures honestly, with the output.** Paste the failing lines. If a
test failed because the test was wrong rather than the feature, say which it
was — a bad test reported as a broken feature wastes the next session. And say
plainly when the bug was your own.

One environment trap sits under all of this: **the running server does not
reload.** It is started as a plain process with no watcher, so a server-side
edit is invisible until a restart, while static assets are served fresh. A
screenshot pass run after editing server code without restarting verifies the
*old* code and passes. Restart first, every time.

### The test ladder

| Rung | Command shape | Covers |
|---|---|---|
| Unit | `npm test` | Rules, arithmetic, matching, dates, derived status |
| Browser suites | `npm run test:<feature>` | Anything a user touches: forms, keyboard paths, in-place edits, resumed state |
| Mobile audit | `npm run audit:mobile` | Touch targets, inputs that trigger iOS zoom, content behind fixed chrome, overflow |
| Screenshots | `npm run shot` | Every page, two widths, both themes, console errors, overflow |

Wire a `test:all` that chains them, so one command is the gate, but keep each
suite runnable alone — when one fails you iterate on it, not on the chain.

**Unit tests get the rules.** Anything that is a pure function of its inputs — a
derived figure, a threshold, a status band, a weighted draw, a string
comparison, a date difference — belongs here, with no database and no server.
These must be exhaustive: a silent arithmetic mistake corrupts months of
accumulated records before anyone notices, and no screenshot shows it. Pin the
behaviour you deliberately chose, including the parts that look like bugs, so a
future session cannot quietly "fix" them.

**Browser suites get everything a user touches.** They are slower and need a
running server, and they still pay, because the bugs they catch cannot be
reached otherwise: a handler bound to the wrong element, a shortcut that
swallows typed text, a form whose default option submits an empty value, a page
that loses its place on reload. Each of those has shipped past a green unit
suite. Two habits follow:

- **Test the form, not the query string.** A request that simply omits an
  optional parameter exercises a path no user takes. A select whose default
  option has an empty value submits `type=`, a different input from "absent".
  Drive the real form and press the real button.
- **Test a keyboard path apart from the mouse path** — both that the key fires
  when it should and that it still types normally when it should not.

### Writing a browser suite in this house style

No test framework. Each suite is a standalone script run by `tsx` that prints
`ok`/`FAIL` lines and exits non-zero. The harness is six lines, so there is no
framework behaviour to learn and nothing to configure.

```ts
// One sentence on what this proves — ideally the bug that caused it to exist.
//   npx tsx scripts/test-thing.ts  (server running, demo account seeded)
import { chromium } from "playwright";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

// Any error in the page is a failure, even if every assertion passes.
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`${BASE}/login`); // the seeded demo account, never real data
await page.fill("#email", "demo@example.local");
await page.fill("#password", "demopassword");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login")),
  page.click('button[type="submit"]'),
]);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

console.log("\nWhat this group is about\n"); // ... interact, then check(...)

if (errors.length > 0) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}
console.log(`\n${failures === 0 ? "It works." : `${failures} problem(s).`}\n`);
await browser.close();
if (failures > 0) process.exit(1);
```

- `check` takes a **third `detail` argument** and you should nearly always pass
  it. `FAIL counter advanced` tells you nothing; `FAIL counter advanced  3 / 14
  -> 3 / 14` tells you everything. Group the checks under `console.log`
  headings, so the output doubles as a description of the behaviour.
- **Console and page errors count as failures.** A feature that works while
  throwing is not working.
- When the claim is about what was *stored* rather than what was shown, import
  the data layer and query it directly, driving the app over `fetch` with the
  session cookie. That is sharper than clicking the UI.

#### Waiting traps

**Wait for the element that proves the state changed, not one that is always
present.** If a control is only *disabled* between steps and never removed,
`waitForSelector` on it returns instantly, the next assertion reads stale state,
and a working feature looks broken. Give every wait an explicit, generous
timeout: a default-timeout failure reads like a hang, an explicit one fails fast
and names the selector.

```ts
await page.waitForSelector(".answer-input");                              // wrong: always in the DOM
await page.waitForSelector(".result", { state: "detached", timeout: 10_000 }); // right: it goes away
```

**Prefer `state: "hidden"` over `"detached"` when the container is merely
hidden.** At the end of a flow the whole panel is often hidden rather than
emptied, so the element stays in the DOM out of sight and `"detached"` never
resolves; `"hidden"` covers both cases.

**Never put a named inner function inside `page.evaluate`.** `tsx` compiles with
esbuild's `keepNames`, which injects a `__name` helper that does not exist in the
browser, so a named function in the evaluated body makes the whole call throw.
Keep those bodies to plain statements and inline arrow functions.

### The screenshot pass

One script captures **every page at two widths (desktop and a 390px phone) in
both light and dark**, writing `screenshots/<key>-<width>-<theme>.png`. Pages
needing a state get a `prepare` hook that clicks into it first, and two accounts
are used — the populated demo account and an empty one — so empty states are
reviewed as deliberately as full ones.

It is **the UI equivalent of a test suite** and must stay at zero warnings:

- **Console errors** are collected per page and printed beside the filename, and
  on failure too, since they are usually why a `prepare` step gave way.
- **Horizontal overflow** is caught by comparing
  `document.documentElement.scrollWidth` with `window.innerWidth`, then walking
  `body *` for the element whose `getBoundingClientRect().right` sticks out
  furthest, and naming it: the report should say *what* overflowed. A companion
  `diagnose-overflow.ts` lists a page's offenders **deepest first** — the
  innermost element is usually the cause, the outermost just the container being
  dragged wide.

**`fullPage` screenshots misplace `position: fixed` elements**, rendering them at
their scroll position so a fixed bottom bar appears to float mid-page. Review
fixed chrome with a `--viewport` flag capturing only the visible area. Add
`--only=`, `--light` and `--desktop` too: a full pass is slow, and iterating on
one page should cost seconds.

### Seeded demo data

Suites and screenshots run against a **seeded demo account, never real data.** A
seed script creates one account with enough records and history to exercise
every page, plus a second empty account for empty states; both use a known email
and password that every suite hard-codes, so a destructive assertion costs
nothing. **The seed script writes to the live database**, so make it additive
only and safe to re-run, and pair it with a clean-up that removes *only* the
seeded accounts — run that afterwards, every time, and keep it well apart from
any "reset everything" script. A suite creating records of its own needs the
same: repeat runs must not accumulate junk that changes later results.

### Data integrity rules

Each of these exists because the alternative failed.

**Derive anything that depends on today's date; never store it.** A value whose
inputs include "how long since this happened" is stale by the next morning, so
compute it on read from the stored facts. The cost is that it cannot appear in
an `ORDER BY`; that sort happens in memory over the filtered set instead, which
is better than a field that is wrong by breakfast.

**Rebuild aggregate rows from the event log; never increment them.** Every write
recomputes the aggregate from the events it summarises, and a suite asserts the
invariant after every operation: the aggregate equals what the events add up to.

```ts
// The only way an aggregate is ever written.
export function tally(results: readonly boolean[]) {
  let good = 0, streak = 0;
  for (const ok of results) {
    if (ok) { good += 1; streak = Math.min(STREAK_TARGET, streak + 1); } else { streak = 0; }
  }
  return { total: results.length, good, streak };
}

// The invariant, checked after each recorded event in a suite.
const matchesEvents = () => {
  const all = events(), r = row();
  return Boolean(r) && r!.total === all.length && r!.good === all.filter((e) => e.ok).length;
};
```

An increment that goes wrong once stays wrong for good: nothing corrects it and
the drift compounds. A rebuild is self-healing — fix the code and the next write
repairs the row.

**Store one row per event, so history is replayable.** The log is what makes a
per-record history reconstructible, a per-day count possible and a botched
aggregate repairable. Give each row the identifiers you will later want to group
by — a session or request id as well as a timestamp — since inferring them
afterwards from gaps between timestamps is guesswork.

**A correction mutates the event; it is not a new event.** "Actually that was
right — count it" marks the existing row corrected and adds nothing. Recording a
second, positive event while leaving the original makes one action count as two,
one each way, and skews every count, rate and streak derived from it. That bug
shipped, and sat in the handbook as a documented quirk for weeks before it was
fixed; the fix then needed a migration to merge historical rows.

**Back up before any destructive script, and have the script take its own
backup.** Use the database's online backup API, not a file copy — a copy can
catch a write half-done and, in WAL mode, miss what is not yet checkpointed.
Label backups by kind (`nightly-<date>`, `pre-deploy-<timestamp>`) and prune per
label: one name per day means a second run overwrites the only good copy.

**Dry-run by default, with an explicit `--apply`.** A script that changes data
prints what it would do and exits; acting takes a separate word the operator has
to type. A one-off repair script also refuses a second run (a marker file) and
verifies its own premise first — a replay computing a correction should prove it
reproduces the stored history unchanged before it is trusted.

**Fix a miscount immediately, with a regression test.** Anything that misreports
what the app recorded — a count, an event, a snapshot — is fixed in the session
it is found, with a test that fails on the old behaviour, or raised plainly with
the owner as a decision. Writing it up as a known quirk feels responsible and is
not: the record keeps accumulating wrong while the note sits.

**Watch the coercions that fake a value.** `Number("")` is `0`, not `NaN`, and
`Number.isInteger(0)` is `true`, so an empty form field validates as a real id
of zero and silently filters everything away. Parse optional numeric parameters
through one helper that treats empty as absent, and use it everywhere.

### Before calling a change done

1. `npm run typecheck` — clean.
2. **Restart the server** if any server-side file changed.
3. `npm test` — the unit suite, clean.
4. The browser suites covering what you touched, plus any whose area you could
   plausibly have broken; `npm run test:all` if in doubt.
5. Anything visual: `npm run shot`, **look at the images**, zero console-error
   and overflow warnings; `--viewport` for fixed chrome.
6. Anything on a narrow layout: `npm run audit:mobile`, zero problems.
7. Anything touching stored data: assert the aggregate still equals the event
   log, and add that assertion to a suite if it is not there yet.
8. Clean up seeded and test-created records.
9. Update the handbook in the same change — decisions, traps, anything a future
   session would otherwise rediscover.
10. Report what passed, what failed, and what was your own error.

---

## GitHub, CI and deployment

Takes the app from a local folder to a live HTTPS site on a server that already
hosts another app. Follow it in order. `<app>` is a short lowercase name
(`myapp` below); `<port>` is the port chosen in step 6.

### The target environment — facts

All of these were checked against the live machine on 2026-10-27. Check them
again yourself before you rely on them — `ss -tlnp`, `caddy version`,
`node --version`, `free -h`, `df -h /` — and correct this list where reality
has moved on.

- A **Hetzner VPS** (2 vCPU, 4 GB, 38 GB disk), **Ubuntu 26.04.1 LTS**,
  **Node 24.21.0**, **npm 11.19.0**, **Caddy 2.6.2**, public IPv4
  **`91.99.202.188`**, SSH `root@91.99.202.188`, **keys only**. The firewall
  allows inbound TCP **22, 80, 443 only**.
- **There is already an app on this machine, and it is in use.** Everything
  below is written so that nothing you do touches its user, folder, database,
  service, port or hostname. Keep it that way: the one shared file you will
  edit is Caddy's, in step 6a, and that step preserves the existing block
  verbatim.
- **Caddy owns 80/443** and routes by hostname. Each app listens on
  **`127.0.0.1` only**, on its own port. An existing app holds **3000**;
  **3001–3005 were free** at the time of writing, so take the next one after
  checking.
- **Hostnames are free, with no DNS work and no purchase.** Any
  `<prefix>.91-99-202-188.sslip.io` already resolves to `91.99.202.188`
  (confirmed by lookup), so `myapp.91-99-202-188.sslip.io` can be served over
  HTTPS at once, Caddy fetching and renewing the certificate itself. sslip.io
  is a shared domain and is **not** on the Public Suffix List, so Let's
  Encrypt's per-registered-domain limit for **new** certificates is shared with
  everyone else using it; renewals of a certificate you already hold are
  exempt. If an issue fails, wait and retry, or name an explicit fallback
  issuer. A real domain avoids this entirely — ask the owner before buying one.
- Each app gets its own **Linux system user**, **`/opt/<app>`**, **`.env` at
  mode 600**, **systemd unit**, **nightly backup timer** and
  **`/etc/caddy/sites/<app>.caddy`**.

### 1. Create the GitHub repo and push

```bash
cd /path/to/myapp
git init -b main
printf 'node_modules/\n.env\ndata/\n' >> .gitignore
git add -A && git commit -m "Initial commit"
# With the GitHub CLI present and authenticated (gh auth status):
gh repo create myapp --public --source=. --remote=origin --push
```

Without `gh`, the owner creates an empty repo at <https://github.com/new> — no
README, no .gitignore, no licence — then `git remote add origin
https://github.com/<owner>/myapp.git && git push -u origin main`.

Confirm `git remote -v` shows `origin`. Keep the default branch `main`: the
workflow and the deploy script both assume it.

### 2. The CI workflow

`.github/workflows/deploy.yml`. The `check` job runs on every push; `deploy`
runs only when the repository variable `DEPLOY_ENABLED` is `true`, so pushes are
safe for days before the server side exists.

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

# One deploy at a time. A newer push waits rather than racing it.
concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      # Only the suites needing no running server and no browser.
      - run: npm test

  deploy:
    needs: check
    if: ${{ vars.DEPLOY_ENABLED == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - name: Deploy over SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
          HOST: ${{ secrets.DEPLOY_HOST }}
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          # Pinned host key: refuse anything pretending to be the server.
          printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          # The server ties this key to one command, so none is sent.
          ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes \
            -o StrictHostKeyChecking=yes "root@$HOST"
```

**Why browser suites run locally, not in CI.** They need the app's own server up
and a real Chrome, whose fonts, voices and viewport differ from a runner's. They
are slow and fail for reasons that are not the code, and a CI nobody trusts gets
ignored. Run them locally before pushing anything visual.

**Why the concurrency group.** The deploy mutates one checkout on one machine.
`cancel-in-progress: false` queues a second push instead of cancelling the first
part-way through `npm ci`, which would leave a broken `node_modules` live.

### 3. The deploy script

`deploy/deploy.sh` in the repo: back up, pull, install, restart, then prove the
site answers.

```bash
#!/usr/bin/env bash
# Update the server to the latest code on GitHub and restart.
#
# Runs on every push to main, through a copy installed BY HAND at
# /usr/local/bin/myapp-deploy — the only command the GitHub deploy key may run.
# By hand:  ssh root@91.99.202.188 myapp-deploy
# After editing this file, reinstall that copy:
#   install -m 755 /opt/myapp/deploy/deploy.sh /usr/local/bin/myapp-deploy
set -euo pipefail

NAME=myapp
APP=/opt/$NAME
PORT=3001
HEALTH=/            # a path returning 200 without signing in
cd "$APP"

# Migrations run at boot, so a copy taken just before is the undo button.
# Drop this block if the app has no database.
echo "→ Backing up the database"
sudo -u "$NAME" -H "$APP/node_modules/.bin/tsx" scripts/backup-db.ts \
  --label=pre-deploy --keep=10

echo "→ Pulling the latest code"
sudo -u "$NAME" -H git pull --ff-only

echo "→ Installing dependencies"
sudo -u "$NAME" -H npm ci --omit=dev

echo "→ Restarting"
systemctl restart "$NAME"

# Wait for it to answer, so a broken deploy fails loudly — and fails the
# GitHub run — rather than leaving the site down unnoticed.
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT$HEALTH"; then
    echo "✓ $NAME is up at $(sudo -u "$NAME" git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "✗ $NAME did not come back up. Last log lines:"
journalctl -u "$NAME" -n 30 --no-pager
exit 1
```

`--ff-only` refuses to merge: if the server's checkout has diverged the deploy
stops rather than inventing a merge commit as root.

**Why it is installed by hand, not run from the repo.** The GitHub key is pinned
to one command. If that command were `/opt/myapp/deploy/deploy.sh`, anyone who
could push — a public repo, so anyone who gets into the owner's GitHub account —
could rewrite what runs as root on the next push. A root-owned copy at
`/usr/local/bin/myapp-deploy`, not writable by the app user, breaks that chain:
a push can change the app, never the privileged command. The cost is one manual
reinstall whenever `deploy.sh` changes.

### 4. The deploy key and the GitHub secrets

On your own machine, a key used for nothing else. Press Enter at both passphrase
prompts — Actions cannot type one.

```bash
ssh-keygen -t ed25519 -C myapp-deploy -f ~/.ssh/myapp_deploy
cat ~/.ssh/myapp_deploy.pub            # public half, for the server
ssh-keyscan -t ed25519 91.99.202.188   # the server's identity, for GitHub
```

On the server, pasting your own public key in place of the example:

```bash
echo 'command="/usr/local/bin/myapp-deploy",restrict ssh-ed25519 AAAA… myapp-deploy' \
  >> /root/.ssh/authorized_keys
```

`command=` forces that command whatever the client asks for; `restrict` disables
port, agent and X11 forwarding and PTY allocation. Never reuse another app's
deploy key, and never edit an `authorized_keys` line you did not add.

**A human must paste the secrets into GitHub — an agent cannot.** Repo
**Settings → Secrets and variables → Actions**:

| Secret | Paste |
|---|---|
| `DEPLOY_HOST` | `91.99.202.188` |
| `DEPLOY_SSH_KEY` | the whole **private** key file `~/.ssh/myapp_deploy`, `-----BEGIN`/`-----END` lines included |
| `DEPLOY_KNOWN_HOSTS` | the exact line `ssh-keyscan` printed |

| Variable | Set |
|---|---|
| `DEPLOY_ENABLED` | `true`, once steps 5 and 6 are done |

Until then, pushes run the checks and skip the deploy. Test with **Actions →
Deploy → Run workflow**.

### 5. The systemd unit

`deploy/<app>.service` in the repo, installed at
`/etc/systemd/system/<app>.service`.

```ini
[Unit]
Description=myapp web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=myapp
Group=myapp
WorkingDirectory=/opt/myapp
EnvironmentFile=/opt/myapp/.env
Environment=NODE_ENV=production
ExecStart=/opt/myapp/node_modules/.bin/tsx src/server.ts
Restart=on-failure
RestartSec=3

# Hardening. The app only ever writes its own data directory, so everything
# else is read-only to it, and it cannot gain privileges.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/myapp/data

[Install]
WantedBy=multi-user.target
```

`ExecStart` must be absolute — systemd has no useful `PATH`: `/usr/bin/node
dist/server.js` for a built app, or the `node_modules/.bin` binary for a runner
such as `tsx`. If the app writes anywhere besides `data/` (uploads, a cache),
add that path to `ReadWritePaths` or it dies with a read-only filesystem error.

`PORT` and `HOST` come from `/opt/myapp/.env`, which holds `PORT=3001`,
`HOST=127.0.0.1`, `NODE_ENV=production` and the app's secrets.

**Why `0.0.0.0` is wrong on a server.** It puts the app's own port on the public
IP, reachable without HTTPS, without the security headers and without whatever
Caddy does in front. Loopback-only makes Caddy the single way in. A framework
behind a proxy must also trust the proxy for **loopback only** (Fastify
`trustProxy`, Express `trust proxy`), or every visitor reads as `127.0.0.1` and
every request as plain HTTP — breaking per-IP rate limits and `Secure` cookies.

### 6. Standing the site up on the shared server

Everything as root over SSH. Check the port first; do not guess.

```bash
ss -tlnp                       # what is listening; 3000 is taken
cat /etc/caddy/Caddyfile       # read the live config before changing anything
```

**6a. One-file-per-site Caddy layout, if it is not already.** If the live
Caddyfile is a single site block with no `import`, convert it once: back it up,
move the existing block **unchanged** into `/etc/caddy/sites/<existing>.caddy`,
and leave only shared settings plus the import in the main file. If the other
app's repo ships a `migrate-caddy.sh`, use it — it does exactly this, validates,
and restores the original if validation fails.

```caddy
# /etc/caddy/Caddyfile — shared only. Each site file says `import common`.
(common) {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
}

import /etc/caddy/sites/*.caddy
```

```bash
cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%dT%H%M%S)
mkdir -p /etc/caddy/sites
# …move the existing block, write the file above…
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

On failure, copy the `.bak` back and reload.

**6b. User, clone, install, configure.**

```bash
adduser --system --group --no-create-home --home /opt/myapp myapp
mkdir -p /opt/myapp && chown myapp:myapp /opt/myapp
sudo -u myapp -H git clone https://github.com/<owner>/myapp.git /opt/myapp
cd /opt/myapp
sudo -u myapp -H npm ci --omit=dev
sudo -u myapp mkdir -p data

install -m 600 -o myapp -g myapp /dev/null /opt/myapp/.env
sudo -u myapp nano /opt/myapp/.env        # PORT, HOST=127.0.0.1, secrets
```

Secrets live only in that file: never in git, a Caddy file or a unit file, and
never copied from the other app — one key per app, so one leak does not reach
the others. A private repo needs its own read-only GitHub deploy key, not a
personal token on the server.

**6c. Start it and verify on loopback, before Caddy is involved.**

```bash
cp deploy/myapp.service /etc/systemd/system/
install -m 755 deploy/deploy.sh /usr/local/bin/myapp-deploy
systemctl daemon-reload
systemctl enable --now myapp
systemctl status myapp                     # active (running)
journalctl -u myapp -n 30
curl -sI http://127.0.0.1:3001/ | head -1  # must answer here first
```

This separates "the app is broken" from "the proxy is broken". Do not go on
until a status line comes back.

**6d. Only now, the Caddy file.**

```bash
cat > /etc/caddy/sites/myapp.caddy <<'EOF'
myapp.91-99-202-188.sslip.io {
	import common
	header X-Frame-Options "DENY"
	reverse_proxy 127.0.0.1:3001
}
EOF
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
curl -sI https://myapp.91-99-202-188.sslip.io/ | head -1
```

The first request can take a few seconds while Caddy fetches the certificate.

- **Never overwrite the shared `/etc/caddy/Caddyfile`** with a template. Add a
  file under `/etc/caddy/sites/`. A `sed … > /etc/caddy/Caddyfile` deletes every
  other site on the machine.
- **`caddy validate` before every `reload`, and `reload`, not `restart`.** A
  failed reload leaves the old config serving; a failed restart takes every site
  down.
- Confirm you broke nothing: `systemctl is-active caddy myapp <existing>`, and
  `curl -sI` the existing app's hostname.

Then set `DEPLOY_ENABLED=true` (step 4) and push a commit to watch the pipeline
deploy end to end.

### 7. Nightly backups

One service and one timer per app, in the repo and installed into
`/etc/systemd/system/`.

```ini
# myapp-backup.service — one backup, run by myapp-backup.timer.
[Unit]
Description=Back up the myapp database
[Service]
Type=oneshot
User=myapp
Group=myapp
WorkingDirectory=/opt/myapp
EnvironmentFile=/opt/myapp/.env
ExecStart=/opt/myapp/node_modules/.bin/tsx scripts/backup-db.ts
```

```ini
# myapp-backup.timer — 03:30 server time. Persistent: if the server was off
# then, it runs at the next boot instead.
[Unit]
Description=Nightly myapp database backup
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
```

```bash
cp deploy/myapp-backup.service deploy/myapp-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now myapp-backup.timer
systemctl list-timers myapp-backup.timer    # next run
```

`scripts/backup-db.ts` must take a **consistent** copy, not a file copy: in WAL
mode a plain `cp` can catch a write half-done and miss whatever is still in the
`-wal` file. Use SQLite's online backup API (`better-sqlite3`'s
`db.backup(target)`), which checkpoints for you. **Label the kinds and keep
their retention apart:** `app-<date>.db` nightly (keep 14) and
`pre-deploy-<timestamp>.db` from the deploy script (keep 10), pruning only files
of the same label. One shared name per day meant a second deploy overwrote the
only good copy taken before a broken first one.

**The honest caveat:** these copies sit on the server's own disk. They undo
mistakes; they do not survive losing the server. For that, switch on the
provider's whole-disk backups, or pull one off the machine now and then
(`scp root@91.99.202.188:/opt/myapp/data/backups/app-<date>.db .`). Say so
plainly rather than implying the data is safe.

**Restoring:** `systemctl stop myapp`, copy the backup over `data/app.db`,
delete `data/app.db-wal` and `data/app.db-shm`, `chown myapp:myapp data/app.db`,
`systemctl start myapp`.

### 8. Database migrations

**Run migrations at application boot**, before the HTTP server listens, and
refuse to start if one fails. A deploy then migrates itself: `systemctl restart`
is the whole procedure, with no second command to forget. The pre-deploy backup
in step 3 is the undo button, which is why it is taken before the restart.

Keep migrations forward-only and additive where possible — a nullable column, a
new table — so rolling the code back still runs against the migrated database.
Never run a destructive migration without confirming a fresh pre-deploy backup
exists.

### 9. Rules for not breaking the app already on the machine

- **Do not touch the other app's user, folder, `.env`, database, unit or port.**
  Its data is real and is not yours to restart, move or write over.
- **3000 is taken.** Run `ss -tlnp` before choosing, take the next free port
  from 3001 up, never reuse one. Caddy's admin API holds 2019 — leave it.
- **Keep a port register** — app, hostname, port, user, folder, service — in
  this repo's deployment notes, so the next person does not pick a taken port.
- **Never open extra firewall ports.** 22, 80 and 443 are the entire public
  surface; exposing 3001 would bypass Caddy, HTTPS and the security headers. If
  you add Docker, publish as `-p 127.0.0.1:3001:3001` — plain `-p 3001:3001`
  binds every interface and sidesteps the host's own rules.
- **One app per user, per folder, per port, per hostname.** Never two sites on
  one hostname.
- **Do not change the firewall, `sshd` config or `authorized_keys` lines you did
  not add.** A mistake there locks the owner out, and the only fix is the
  provider's web console.
- **Do not `apt upgrade` or reboot casually.** Unattended security updates are
  already on; a reboot takes every site down for a minute.
- **Watch capacity:** `free -h`, `df -h /`, `systemctl status <app>` for memory.
  Do not run a heavy build or install on the server without checking.
- **The running server does not reload.** It is a plain Node process under
  systemd with no watcher, so an edit under `src/` is invisible until
  `systemctl restart <app>`; static files are served fresh. Verifying without
  restarting tests the old code.

---

## Keep the handbook current

The file you are reading started as a generic playbook and became the record of
one app. Do the same with yours. In the same change that introduces a decision,
add it: what was chosen, what it was chosen over, and why. In the same change
that fixes a bug that cost you an hour, add the trap: what looked wrong, what
was actually wrong, and the rule that prevents it.

Two sections earn their keep fastest:

- **Decisions and why** — so a future session does not relitigate a settled
  choice, or quietly undo it.
- **Traps worth remembering** — the specific, surprising, hard-won things: the
  tool that silently did nothing, the test that passed for the wrong reason,
  the CSS that inverted in dark mode. This is the section that makes the next
  session fast.

Write them as prose with the reason attached, not as a bullet list of rules. A
rule without its reason gets dropped the first time it is inconvenient.

## Before you call anything done

The checklist is the numbered one at the end of "Verification and data
integrity" — run it, and report what passed, what failed, and what was your own
error. Three of its steps are the ones most often skipped, so they are worth
repeating here:

- **Restart the server** before believing a screenshot. Nothing in `src/`
  reloads by itself; a pass taken without a restart verifies the old code.
- **Look at the images.** A screenshot run that exits 0 proves nothing was
  thrown. Only your eyes prove the page is right.
- **Update the handbook in the same change.** Not afterwards, and not "next
  time" — a decision undocumented for a week is a decision lost.

Then say plainly what is live, what is not, and what you did not do.
