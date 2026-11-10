// The built-in maps, and the small builder used to draw them.
//
// Maps are symmetric so no seat starts with an advantage. Rather than author
// every tile twice (and get the copy wrong), a map draws one seat's share
// through a "pen" and the builder replays those strokes rotated for every
// other seat. Bases drawn by the pen belong to the seat the rotation is for.
import type { EdgeKind, IncomeSite, MapDef, Point, Side, Terrain } from "./types.js";

export interface Transform {
  point(p: Point): Point;
  side(s: Side): Side;
}

/** How the map editor repeats a stroke: not at all, a half turn, or four quarter turns. */
export type SymmetryMode = "none" | "mirror" | "fourway";

/**
 * The transforms a stroke is repeated through, one per image. Image k of a
 * base stroke belongs to the seat k places on from the one painted, which is
 * also how the built-in maps hand each seat its base.
 */
export function symmetryTransforms(mode: SymmetryMode, w: number, h: number): Transform[] {
  if (mode === "mirror") return [identity(), rotate180(w, h)];
  if (mode === "fourway" && w === h) return [identity(), rotate90(w, 1), rotate90(w, 2), rotate90(w, 3)];
  return [identity()];
}

const OPPOSITE: Record<Side, Side> = { n: "s", s: "n", e: "w", w: "e" };
const CLOCKWISE: Record<Side, Side> = { n: "e", e: "s", s: "w", w: "n" };

function identity(): Transform {
  return { point: (p) => p, side: (s) => s };
}

function rotate180(w: number, h: number): Transform {
  return { point: (p) => ({ x: w - 1 - p.x, y: h - 1 - p.y }), side: (s) => OPPOSITE[s] };
}

/** A quarter turn clockwise. Only meaningful on a square map. */
function rotate90(n: number, times: number): Transform {
  return {
    point: (p) => {
      let q = p;
      for (let i = 0; i < times; i++) q = { x: n - 1 - q.y, y: q.x };
      return q;
    },
    side: (s) => {
      let t = s;
      for (let i = 0; i < times; i++) t = CLOCKWISE[t];
      return t;
    },
  };
}

interface Opening {
  doors?: string[];
  windows?: string[];
}

export class MapBuilder {
  readonly terrain: Terrain[];
  readonly hEdges: (EdgeKind | null)[];
  readonly vEdges: (EdgeKind | null)[];
  readonly bases: Point[][];
  readonly posts: Point[] = [];
  readonly income: IncomeSite[] = [];

  constructor(
    readonly meta: { id: string; name: string; blurb: string; width: number; height: number; seats: number },
    ground: Terrain = "grass",
  ) {
    const { width: w, height: h } = meta;
    this.terrain = new Array<Terrain>(w * h).fill(ground);
    this.hEdges = new Array<EdgeKind | null>(w * (h + 1)).fill(null);
    this.vEdges = new Array<EdgeKind | null>((w + 1) * h).fill(null);
    this.bases = Array.from({ length: meta.seats }, () => []);
  }

  setTerrain(p: Point, t: Terrain) {
    this.terrain[p.y * this.meta.width + p.x] = t;
  }

  setEdge(p: Point, side: Side, kind: EdgeKind | null) {
    const w = this.meta.width;
    if (side === "n") this.hEdges[p.y * w + p.x] = kind;
    else if (side === "s") this.hEdges[(p.y + 1) * w + p.x] = kind;
    else if (side === "w") this.vEdges[p.y * (w + 1) + p.x] = kind;
    else this.vEdges[p.y * (w + 1) + p.x + 1] = kind;
  }

  addPost(p: Point) {
    if (!this.posts.some((q) => q.x === p.x && q.y === p.y)) this.posts.push(p);
  }

  addIncome(p: Point, value: number) {
    if (!this.income.some((q) => q.x === p.x && q.y === p.y)) this.income.push({ ...p, value });
  }

  /** Draw with no symmetry: for features on the centre of the map. */
  pen(): Pen {
    return new Pen(this, identity(), 0);
  }

  /** Draw once per seat, rotated: two seats are a half turn apart, four a quarter turn. */
  symmetric(draw: (pen: Pen) => void) {
    const { width: w, height: h, seats } = this.meta;
    const transforms =
      seats === 2
        ? [identity(), rotate180(w, h)]
        : [identity(), rotate90(w, 1), rotate90(w, 2), rotate90(w, 3)];
    if (seats === 4 && w !== h) throw new Error(`${this.meta.id}: four-seat maps must be square`);
    transforms.forEach((t, seatOffset) => draw(new Pen(this, t, seatOffset)));
  }

  build(): MapDef {
    return {
      ...this.meta,
      terrain: this.terrain,
      hEdges: this.hEdges,
      vEdges: this.vEdges,
      bases: this.bases,
      posts: this.posts,
      income: this.income,
    };
  }
}

export class Pen {
  constructor(
    private readonly b: MapBuilder,
    private readonly t: Transform,
    private readonly seatOffset: number,
  ) {}

  tile(x: number, y: number, terrain: Terrain) {
    this.b.setTerrain(this.t.point({ x, y }), terrain);
  }

  rect(x: number, y: number, w: number, h: number, terrain: Terrain) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.tile(x + i, y + j, terrain);
  }

  edge(x: number, y: number, side: Side, kind: EdgeKind | null) {
    this.b.setEdge(this.t.point({ x, y }), this.t.side(side), kind);
  }

  /** A run of edges along the top of tiles (x .. x+len-1, y). */
  hwall(x: number, y: number, len: number, kind: EdgeKind = "wall") {
    for (let i = 0; i < len; i++) this.edge(x + i, y, "n", kind);
  }

  /** A run of edges down the left of tiles (x, y .. y+len-1). */
  vwall(x: number, y: number, len: number, kind: EdgeKind = "wall") {
    for (let j = 0; j < len; j++) this.edge(x, y + j, "w", kind);
  }

  /**
   * A walled building with a floor. Openings are named by side and offset
   * along it, counted from the top-left: "s1" is the second tile of the south
   * wall, "e0" the top tile of the east wall.
   */
  building(x: number, y: number, w: number, h: number, open: Opening = {}) {
    this.rect(x, y, w, h, "floor");
    for (let i = 0; i < w; i++) {
      this.edge(x + i, y, "n", "wall");
      this.edge(x + i, y + h - 1, "s", "wall");
    }
    for (let j = 0; j < h; j++) {
      this.edge(x, y + j, "w", "wall");
      this.edge(x + w - 1, y + j, "e", "wall");
    }
    const place = (spec: string, kind: EdgeKind) => {
      const side = spec[0] as Side;
      const at = Number(spec.slice(1));
      if (side === "n") this.edge(x + at, y, "n", kind);
      else if (side === "s") this.edge(x + at, y + h - 1, "s", kind);
      else if (side === "w") this.edge(x, y + at, "w", kind);
      else this.edge(x + w - 1, y + at, "e", kind);
    };
    for (const d of open.doors ?? []) place(d, "door");
    for (const wdw of open.windows ?? []) place(wdw, "window");
  }

  /** Spawn tiles for the seat this stroke is drawn for. */
  base(x: number, y: number, w: number, h: number) {
    const seat = this.seatOffset;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.b.bases[seat]!.push(this.t.point({ x: x + i, y: y + j }));
  }

  post(x: number, y: number) {
    this.b.addPost(this.t.point({ x, y }));
  }

  income(x: number, y: number, value: number) {
    this.b.addIncome(this.t.point({ x, y }), value);
  }
}

// ---------------------------------------------------------------------------

const crossroads = (() => {
  const b = new MapBuilder({
    id: "crossroads",
    name: "Crossroads",
    blurb: "Two farmhouses and a contested junction. A good first map.",
    width: 25,
    height: 17,
    seats: 2,
  });
  b.symmetric((p) => {
    p.rect(0, 8, 13, 1, "road");
    p.rect(12, 0, 1, 9, "road");
    p.base(0, 7, 2, 2);

    p.building(4, 1, 7, 5, { doors: ["s1", "e3"], windows: ["n2", "n5", "w2", "s4"] });
    p.vwall(8, 1, 2);
    p.post(7, 3);

    p.rect(0, 13, 3, 4, "forest");
    p.income(4, 14, 25);
    p.rect(15, 2, 2, 1, "rock");
    p.tile(16, 3, "rock");
    p.hwall(5, 11, 3, "window");
    p.rect(13, 4, 2, 2, "forest");
    p.tile(10, 7, "crate");
    p.tile(10, 9, "crate");
    p.tile(6, 8, "crate");
  });
  b.pen().post(12, 8);
  return b.build();
})();

const riverside = (() => {
  const b = new MapBuilder({
    id: "riverside",
    name: "Riverside",
    blurb: "Two bridges and a causeway over the river. Hold the crossings.",
    width: 25,
    height: 17,
    seats: 2,
  });
  b.symmetric((p) => {
    p.rect(11, 0, 3, 9, "water");
    p.rect(9, 3, 7, 1, "road");
    p.hwall(11, 3, 3, "window");
    p.hwall(11, 4, 3, "window");
    p.base(0, 7, 2, 2);

    p.building(4, 1, 5, 4, { doors: ["e2", "s1"], windows: ["n1", "n3", "w1"] });
    p.post(6, 2);

    p.rect(8, 10, 2, 3, "forest");
    p.income(7, 13, 25);
    p.rect(3, 12, 2, 2, "rock");
    p.rect(1, 2, 2, 2, "forest");
    p.tile(5, 8, "crate");
    p.hwall(15, 7, 2, "window");
  });
  // The causeway: dry ground across the middle of the river.
  const c = b.pen();
  c.rect(11, 7, 3, 3, "grass");
  c.tile(11, 8, "crate");
  c.tile(13, 8, "crate");
  c.post(12, 8);
  return b.build();
})();

const fourCorners = (() => {
  const b = new MapBuilder({
    id: "four-corners",
    name: "Four Corners",
    blurb: "Four players, four houses, one square in the middle.",
    width: 25,
    height: 25,
    seats: 4,
  });
  b.symmetric((p) => {
    p.rect(12, 0, 1, 12, "road");
    p.base(1, 1, 2, 2);

    p.building(5, 5, 5, 4, { doors: ["s2", "e1"], windows: ["n1", "n3", "w2", "e3"] });
    p.post(7, 6);

    p.income(2, 9, 25);
    p.rect(9, 1, 2, 2, "forest");
    p.rect(0, 9, 2, 2, "forest");
    p.rect(9, 9, 2, 2, "water");
    p.rect(4, 11, 2, 1, "rock");
    p.tile(11, 11, "crate");
    p.hwall(10, 3, 2, "window");
  });
  b.pen().tile(12, 12, "road");
  b.pen().post(12, 12);
  return b.build();
})();

const facility = (() => {
  const b = new MapBuilder(
    {
      id: "facility",
      name: "Facility",
      blurb: "All indoors: rooms, long corridors and one-tile doorways. Hold the chokepoints.",
      width: 27,
      height: 19,
      seats: 2,
    },
    "floor",
  );
  // Columns, west to east: each side's wing (storeroom, base room, armoury),
  // its long service corridor, then the shared middle: a corridor along each
  // map edge, two offices, a lobby, and the hall in the centre.
  // Rows of the middle: corridor 0-1, offices 2-6, lobby and hall 7-11,
  // offices 12-16, corridor 17-18.
  //
  // Drawn in two passes. Every room is walled all round first, then the
  // openings are cut, so one side's walls never close the other's doors
  // (rooms on the centre line share walls with their rotated twins).
  b.symmetric((p) => {
    p.building(0, 0, 5, 6); // storeroom
    p.building(0, 6, 5, 7); // base room
    p.building(0, 13, 5, 6); // armoury
    p.building(5, 0, 2, 19); // service corridor
    p.building(7, 0, 13, 2); // the corridor along the north edge (the south one is its twin)
    p.building(7, 2, 6, 5); // north office
    p.building(7, 12, 6, 5); // south office
    p.building(13, 2, 1, 5); // a one-tile passage from the corridor down to the hall
    p.building(7, 7, 2, 5); // lobby
    p.building(9, 7, 9, 5); // the hall
    // Bulkheads across the edge corridor, each with a single doorway.
    p.vwall(11, 0, 2);
    p.vwall(16, 0, 2);
  });
  b.symmetric((p) => {
    p.base(1, 8, 2, 2);

    // The service corridor meets both edge corridors in open corners.
    p.edge(7, 0, "w", null);
    p.edge(7, 1, "w", null);
    p.edge(7, 17, "w", null);
    p.edge(7, 18, "w", null);
    // Wing: storeroom, base room and armoury, each with a door to the service corridor.
    p.edge(2, 5, "s", "door");
    p.edge(2, 12, "s", "door");
    p.edge(4, 1, "e", "door");
    p.edge(4, 9, "e", "door");
    p.edge(4, 17, "e", "door");
    p.edge(4, 7, "e", "window");
    p.edge(4, 11, "e", "window");
    // From the service corridor into the middle.
    p.edge(7, 4, "w", "door");
    p.edge(7, 9, "w", "door");
    p.edge(7, 14, "w", "door");
    // North office: out to the edge corridor and the passage; windows over the corridor and the hall.
    p.edge(8, 2, "n", "door");
    p.edge(12, 4, "e", "door");
    p.edge(10, 2, "n", "window");
    p.edge(8, 6, "s", "window");
    p.edge(11, 6, "s", "window");
    // South office: out to the far edge corridor and the far passage.
    p.edge(9, 16, "s", "door");
    p.edge(12, 14, "e", "door");
    p.edge(10, 12, "n", "window");
    // The passage's ends: the edge corridor and the hall.
    p.edge(13, 2, "n", "door");
    p.edge(13, 6, "s", "door");
    // Lobby into the hall.
    p.edge(8, 9, "e", "door");
    // The bulkheads' doorways.
    p.edge(11, 1, "w", "door");
    p.edge(16, 0, "w", "door");

    p.post(10, 4);
    p.income(2, 2, 25);
    p.income(10, 14, 20);

    p.tile(11, 8, "crate");
    p.tile(11, 10, "crate");
    p.tile(9, 4, "crate");
    p.tile(8, 15, "crate");
    p.tile(3, 15, "crate");
    p.tile(1, 16, "crate");
    p.tile(6, 6, "crate");
  });
  b.pen().post(13, 9);
  return b.build();
})();

export const MAPS: readonly MapDef[] = [crossroads, riverside, fourCorners, facility];

// Tests register small purpose-built maps here, so the rules can be exercised
// on a board where every wall is placed for the case being tested.
const extraMaps = new Map<string, MapDef>();
export function registerMap(map: MapDef) {
  extraMaps.set(map.id, map);
}

export function getMap(id: string): MapDef {
  const m = MAPS.find((x) => x.id === id) ?? extraMaps.get(id);
  if (!m) throw new Error(`Unknown map: ${id}`);
  return m;
}
