// Maps people make in the editor: storing, checking and listing them. A saved
// map's MapDef id is its row id ("m-xxxxxx"), which can never collide with a
// built-in map's id.
import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db/index.js";
import { maps, type SavedMap } from "./db/schema.js";
import { MAP_LIMITS, checkMap } from "./game/mapcheck.js";
import { MAPS } from "./game/maps.js";
import type { MapDef, Terrain } from "./game/types.js";

const TERRAINS = ["grass", "road", "floor", "forest", "rock", "water", "crate"] as const satisfies readonly Terrain[];

/**
 * The shape of a map as the editor sends it. Sizes are checked against each
 * other after parsing (refine), since the array lengths depend on the
 * dimensions.
 */
export const mapBody = z
  .object({
    name: z.string().trim().max(40),
    blurb: z.string().trim().max(160),
    width: z.number().int().min(MAP_LIMITS.minSize).max(MAP_LIMITS.maxSize),
    height: z.number().int().min(MAP_LIMITS.minSize).max(MAP_LIMITS.maxSize),
    seats: z.number().int().min(2).max(4),
    terrain: z.array(z.enum(TERRAINS)),
    hEdges: z.array(z.enum(["wall", "window", "door"]).nullable()),
    vEdges: z.array(z.enum(["wall", "window", "door"]).nullable()),
    bases: z.array(z.array(z.object({ x: z.number().int().min(0), y: z.number().int().min(0) })).max(MAP_LIMITS.maxBaseTiles * 4)).max(4),
    posts: z.array(z.object({ x: z.number().int().min(0), y: z.number().int().min(0) })).max(MAP_LIMITS.maxPosts * 4),
    income: z
      .array(z.object({ x: z.number().int().min(0), y: z.number().int().min(0), value: z.number().int().min(MAP_LIMITS.minIncomeValue).max(MAP_LIMITS.maxIncomeValue) }))
      .max(MAP_LIMITS.maxIncome * 4),
  })
  .refine(
    (m) =>
      m.terrain.length === m.width * m.height &&
      m.hEdges.length === m.width * (m.height + 1) &&
      m.vEdges.length === (m.width + 1) * m.height &&
      m.bases.length === m.seats &&
      [...m.bases.flat(), ...m.posts, ...m.income].every((p) => p.x < m.width && p.y < m.height),
    "map arrays do not match its size",
  );

export type MapBody = z.infer<typeof mapBody>;

export interface MapEntry {
  row: SavedMap;
  map: MapDef;
  problems: string[];
}

const toDef = (row: SavedMap): MapDef => ({ ...(JSON.parse(row.data) as MapDef), id: row.id, name: row.name });

export function listMaps(ownerId: number): MapEntry[] {
  return db
    .select()
    .from(maps)
    .where(eq(maps.ownerId, ownerId))
    .orderBy(desc(maps.updatedAt))
    .all()
    .map((row) => {
      const map = toDef(row);
      return { row, map, problems: checkMap(map) };
    });
}

/** One of this user's maps. Someone else's id resolves to nothing, not to their map. */
export function getOwnMap(id: string, ownerId: number): MapEntry | null {
  const row = db.select().from(maps).where(and(eq(maps.id, id), eq(maps.ownerId, ownerId))).get();
  if (!row) return null;
  const map = toDef(row);
  return { row, map, problems: checkMap(map) };
}

/** A blank grass field with two small bases and a post in the middle: something to start from. */
export function blankMap(): Omit<MapDef, "id"> {
  const width = 24;
  const height = 16;
  return {
    name: "Untitled map",
    blurb: "",
    width,
    height,
    seats: 2,
    terrain: new Array<Terrain>(width * height).fill("grass"),
    hEdges: new Array(width * (height + 1)).fill(null),
    vEdges: new Array((width + 1) * height).fill(null),
    bases: [
      [{ x: 0, y: 7 }, { x: 0, y: 8 }, { x: 1, y: 7 }, { x: 1, y: 8 }],
      [{ x: 23, y: 8 }, { x: 23, y: 7 }, { x: 22, y: 8 }, { x: 22, y: 7 }],
    ],
    posts: [{ x: 11, y: 7 }],
    income: [],
  };
}

const newMapId = () => `m-${crypto.randomBytes(5).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x")}`;

/**
 * Make a map for this user: blank, or a copy of a built-in map or one of
 * their own. Returns the new id, or null if `from` names nothing they may copy.
 */
export function createMap(ownerId: number, from: string): string | null {
  let base: Omit<MapDef, "id">;
  if (from === "blank") base = blankMap();
  else {
    const builtIn = MAPS.find((m) => m.id === from);
    const own = builtIn ? null : getOwnMap(from, ownerId);
    const source = builtIn ?? own?.map;
    if (!source) return null;
    base = { ...structuredClone(source), name: `${source.name} copy`.slice(0, 40) };
  }
  const id = newMapId();
  const now = Date.now();
  const { name, ...rest } = base;
  db.insert(maps).values({ id, ownerId, name, data: JSON.stringify({ ...rest, name }), createdAt: now, updatedAt: now }).run();
  return id;
}

export function saveMap(id: string, ownerId: number, body: MapBody): MapEntry | null {
  const existing = getOwnMap(id, ownerId);
  if (!existing) return null;
  const name = body.name || "Untitled map";
  db.update(maps)
    .set({ name, data: JSON.stringify({ ...body, name }), updatedAt: Date.now() })
    .where(and(eq(maps.id, id), eq(maps.ownerId, ownerId)))
    .run();
  return getOwnMap(id, ownerId);
}

export function deleteMap(id: string, ownerId: number): boolean {
  return db.delete(maps).where(and(eq(maps.id, id), eq(maps.ownerId, ownerId))).run().changes > 0;
}

/** A map this user may start a game on: a built-in one, or their own if it is playable. */
export function mapForNewGame(id: string, ownerId: number): MapDef | null {
  const builtIn = MAPS.find((m) => m.id === id);
  if (builtIn) return builtIn;
  const own = getOwnMap(id, ownerId);
  return own && own.problems.length === 0 ? own.map : null;
}
