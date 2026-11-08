// Deterministic randomness. A game is stored as its seed plus the actions taken,
// and the state is rebuilt by replaying them, so every roll must come out the
// same on every replay. Each action gets its own stream, derived from the game
// seed and the action's sequence number, so one action's rolls can never shift
// another's.

/** A 32-bit string hash (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast and good enough for dice. Returns values in [0, 1). */
export function streamFor(seed: string, sequence: number): () => number {
  let a = hash(`${seed}:${sequence}`);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
