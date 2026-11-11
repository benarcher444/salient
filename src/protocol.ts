// Messages over the game WebSocket. Everything from a client is parsed here
// before it reaches the rules; the seat is never taken from the client.
import { z } from "zod";
import { UNIT_KINDS } from "./game/units.js";
import type { UnitKind } from "./game/types.js";

const coord = z.number().int().min(0).max(255);
const point = z.object({ x: coord, y: coord });
const facing = z.number().int().min(0).max(359);
const id = z.number().int().positive();

const orders = z.object({
  moves: z.array(z.object({ unitId: id, path: z.array(point).max(32), facing })).max(100),
  spawns: z.array(z.object({ kind: z.enum(UNIT_KINDS as [UnitKind, ...UnitKind[]]), x: coord, y: coord, facing })).max(40),
  routes: z.array(z.object({ unitId: id, to: point, facing: facing.optional() })).max(100).optional(),
});

export const clientMessage = z.object({
  type: z.literal("action"),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("orders"), orders }),
    z.object({ type: z.literal("attack"), unitId: id, targetId: id }),
    z.object({ type: z.literal("hold"), unitId: id }),
    z.object({ type: z.literal("endAttacks") }),
    z.object({ type: z.literal("resign") }),
  ]),
});

export type ClientMessage = z.infer<typeof clientMessage>;
