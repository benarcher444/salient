// What a guest may reach: the one game they joined, and nothing else. Pure, so
// the rule can be read (and tested) on its own; src/guest.ts applies it to
// every request.

/** Paths open to everyone, signed in or not: assets and the rules page. */
const PUBLIC_GET = [/^\/static\//, /^\/how-to-play$/];

/**
 * May a guest whose game is `gameId` make this request? Only: that game's
 * page, its live connection, its replay log (once it is over), its invite link (which sends them to the game),
 * the public pages and assets, and signing out. Anything else is refused,
 * whatever the route, so a new route is closed to guests until listed here.
 */
export function guestMayRequest(method: string, url: string, gameId: string): boolean {
  const path = url.split("?")[0]!;
  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD";
  if (read && PUBLIC_GET.some((re) => re.test(path))) return true;
  if (m === "POST" && path === "/logout") return true;
  const game = `/g/${gameId}`;
  if (read && (path === game || path === `/ws${game}` || path === `${game}/replay` || path.startsWith(`${game}/invite/`))) return true;
  return false;
}
