// The page shell: escaping, the theme attribute, navigation.
import { APP_NAME } from "../config.js";
import type { User } from "../db/schema.js";
import { icons } from "./icons.js";

export type Theme = "auto" | "light" | "dark";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape for HTML text and attribute values. Every interpolated value goes through this. */
export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/**
 * JSON for inside a <script>. `<`, `>` and `&` are escaped as well, or a
 * string containing "</script>" would close the tag.
 */
export const jsonScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

/** Marks a string as already-safe HTML, so templates can nest. */
export type Html = string;

const themeAttr = (t: Theme) => (t === "auto" ? "" : ` data-theme="${t}"`);
const scheme = (t: Theme) => (t === "auto" ? "light dark" : t);

type NavKey = "games" | "rules" | "settings";

const NAV: { key: NavKey; href: string; label: string; icon: string }[] = [
  { key: "games", href: "/", label: "Games", icon: icons.flag },
  { key: "rules", href: "/how-to-play", label: "How to play", icon: icons.book },
  { key: "settings", href: "/settings", label: "Settings", icon: icons.gear },
];

export interface LayoutOptions {
  title: string;
  body: Html;
  user: User | null;
  active?: NavKey;
  /** Full-bleed pages (the battle) drop the standard chrome. */
  bare?: boolean;
  head?: Html;
  scripts?: Html;
}

export function layout(o: LayoutOptions): Html {
  const theme: Theme = o.user?.theme ?? "auto";
  const nav = o.user
    ? NAV.map(
        (n) =>
          `<a href="${n.href}" class="nav-link${o.active === n.key ? " active" : ""}"${o.active === n.key ? ' aria-current="page"' : ""}>${n.icon}<span>${esc(n.label)}</span></a>`,
      ).join("")
    : "";
  const chrome = o.bare
    ? o.body
    : `<header class="topbar">
  <a class="brand" href="/">${icons.logo}<span>${APP_NAME}</span></a>
  ${o.user ? `<nav class="topnav">${nav}</nav><span class="who">${esc(o.user.displayName)}</span>` : ""}
</header>
<main class="page">${o.body}</main>
${o.user ? `<nav class="mobile-bar">${nav}</nav>` : ""}`;

  return `<!doctype html>
<html lang="en"${themeAttr(theme)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="${scheme(theme)}">
<title>${esc(o.title)} · ${APP_NAME}</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/styles.css">
${o.head ?? ""}
</head>
<body class="${o.bare ? "bare" : o.user ? "with-nav" : ""}">
${chrome}
${o.scripts ?? ""}
</body>
</html>`;
}

/** The heading block every page shares. */
export function pageHead(o: { title: string; sub?: string; actions?: Html }): Html {
  return `<div class="page-head">
  <div class="page-head-text"><h1>${esc(o.title)}</h1>${o.sub ? `<p class="sub">${esc(o.sub)}</p>` : ""}</div>
  ${o.actions ? `<div class="page-head-actions">${o.actions}</div>` : ""}
</div>`;
}

export const NO_AUTOFILL =
  'autocomplete="off" autocapitalize="none" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"';
