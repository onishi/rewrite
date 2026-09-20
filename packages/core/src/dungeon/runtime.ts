import type { Floor, DungeonEntity } from "./types.js";
import { idx, tileAt, walkable, entityAt, roomIdAt } from "./types.js";
import { Rng } from "../rng.js";
import { revealRoom } from "./generate.js";

/** Movement, sight and monster behaviour on a generated floor. */

export const DIRS: { dx: number; dy: number; key: string }[] = [
  { dx: 0, dy: -1, key: "n" }, { dx: 1, dy: -1, key: "ne" },
  { dx: 1, dy: 0, key: "e" },  { dx: 1, dy: 1, key: "se" },
  { dx: 0, dy: 1, key: "s" },  { dx: -1, dy: 1, key: "sw" },
  { dx: -1, dy: 0, key: "w" }, { dx: -1, dy: -1, key: "nw" },
];

/**
 * Room-lit visibility: standing in a room lights all of it, standing in a
 * corridor lights only what is next to you.  A torch widens the corridor
 * radius, which is what makes Torchbearer worth carrying underground.
 */
export function computeVisibility(floor: Floor, px: number, py: number, lightRadius: number): void {
  floor.visible.fill(0);
  const light = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= floor.w || y >= floor.h) return;
    floor.visible[idx(floor, x, y)] = 1;
    floor.seen[idx(floor, x, y)] = 1;
  };

  const room = floor.rooms.find((r) => roomIdAt(floor, px, py) === r.id);
  if (room) {
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) light(x, y);
    }
    room.seen = true;
    // doorways hanging off the room stay lit so exits are legible
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        if (tileAt(floor, x, y) !== "door") continue;
        for (const d of DIRS) light(x + d.dx, y + d.dy);
      }
    }
    return;
  }

  const r = Math.max(1, lightRadius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) light(px + dx, py + dy);
  }
}

export function lightRadiusFor(hasTorch: boolean, hasTorchSkill: boolean): number {
  if (hasTorchSkill) return 3;
  if (hasTorch) return 2;
  return 1;
}

/** Breadth-first path, used by monsters and by click-to-move. */
export function findPath(
  floor: Floor, from: { x: number; y: number }, to: { x: number; y: number },
  opts: { blockedBy?: (e: DungeonEntity) => boolean; maxNodes?: number } = {},
): { x: number; y: number }[] | null {
  const maxNodes = opts.maxNodes ?? 4000;
  if (from.x === to.x && from.y === to.y) return [];
  const prev = new Int32Array(floor.w * floor.h).fill(-1);
  const seen = new Uint8Array(floor.w * floor.h);
  const queue: number[] = [idx(floor, from.x, from.y)];
  seen[queue[0]!] = 1;
  const goal = idx(floor, to.x, to.y);
  let visited = 0;

  while (queue.length > 0 && visited++ < maxNodes) {
    const cur = queue.shift()!;
    if (cur === goal) break;
    const cx = cur % floor.w, cy = Math.floor(cur / floor.w);
    for (const d of DIRS) {
      const nx = cx + d.dx, ny = cy + d.dy;
      if (!walkable(floor, nx, ny)) continue;
      // no cutting diagonally through wall corners
      if (d.dx !== 0 && d.dy !== 0) {
        if (!walkable(floor, cx + d.dx, cy) || !walkable(floor, cx, cy + d.dy)) continue;
      }
      const ni = idx(floor, nx, ny);
      if (seen[ni]) continue;
      if (ni !== goal && opts.blockedBy) {
        const e = entityAt(floor, nx, ny);
        if (e && opts.blockedBy(e)) continue;
      }
      seen[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }

  if (!seen[goal]) return null;
  const path: { x: number; y: number }[] = [];
  let cur = goal;
  while (cur !== idx(floor, from.x, from.y)) {
    path.push({ x: cur % floor.w, y: Math.floor(cur / floor.w) });
    cur = prev[cur]!;
    if (cur < 0) return null;
  }
  return path.reverse();
}

export type MoveOutcome =
  | { kind: "blocked" }
  | { kind: "moved" }
  | { kind: "encounter"; entity: DungeonEntity; initiatedByPlayer: true }
  | { kind: "item"; entity: DungeonEntity }
  | { kind: "feature"; entity: DungeonEntity }
  | { kind: "npc"; entity: DungeonEntity };

/** Resolve the player stepping one tile.  Bumping something is how you touch it. */
export function stepPlayer(
  floor: Floor, px: number, py: number, dx: number, dy: number,
): { x: number; y: number; outcome: MoveOutcome } {
  const nx = px + dx, ny = py + dy;
  if (!walkable(floor, nx, ny)) return { x: px, y: py, outcome: { kind: "blocked" } };
  if (dx !== 0 && dy !== 0) {
    if (!walkable(floor, px + dx, py) || !walkable(floor, px, py + dy)) {
      return { x: px, y: py, outcome: { kind: "blocked" } };
    }
  }
  const e = entityAt(floor, nx, ny);
  if (e) {
    if (e.kind === "enemy") {
      return { x: px, y: py, outcome: { kind: "encounter", entity: e, initiatedByPlayer: true } };
    }
    if (e.kind === "npc") return { x: px, y: py, outcome: { kind: "npc", entity: e } };
    if (e.kind === "item") return { x: nx, y: ny, outcome: { kind: "item", entity: e } };
    if (e.kind === "feature") return { x: nx, y: ny, outcome: { kind: "feature", entity: e } };
  }
  return { x: nx, y: ny, outcome: { kind: "moved" } };
}

export interface MonsterTurnResult {
  /** an enemy walked into the player: combat starts without the player's initiative */
  ambushedBy?: DungeonEntity;
  lines: string[];
}

/** Monsters act after the player.  Simple, readable, and enough to create pressure. */
export function monsterTurn(
  floor: Floor, px: number, py: number, rng: Rng,
): MonsterTurnResult {
  const lines: string[] = [];
  let ambushedBy: DungeonEntity | undefined;

  for (const e of floor.entities) {
    if (e.kind !== "enemy" || e.bossId) continue;
    const dist = Math.max(Math.abs(e.x - px), Math.abs(e.y - py));
    const lit = floor.visible[idx(floor, e.x, e.y)] === 1;

    if (!e.awake) {
      if (lit && dist <= (e.sight ?? 5)) {
        e.awake = true;
        lines.push(`${e.name}がこちらに気づいた。`);
      } else continue;
    }
    if (ambushedBy) continue;

    if (dist === 1) { ambushedBy = e; continue; }
    if (dist > (e.sight ?? 5) + 4) { e.awake = false; continue; }

    const path = findPath(floor, e, { x: px, y: py }, {
      blockedBy: (o) => o.kind === "enemy" && o.uid !== e.uid,
      maxNodes: 900,
    });
    const next = path?.[0];
    if (!next) continue;
    if (next.x === px && next.y === py) { ambushedBy = e; continue; }
    if (entityAt(floor, next.x, next.y)) continue;
    e.x = next.x; e.y = next.y;
  }

  return { ambushedBy, lines };
}

/** Text rows of what the player currently knows about the floor. */
export function renderFloor(
  floor: Floor, px: number, py: number,
): { rows: string[]; entities: { uid: string; x: number; y: number; glyph: string; kind: string; name: string }[] } {
  const rows: string[] = [];
  for (let y = 0; y < floor.h; y++) {
    let row = "";
    for (let x = 0; x < floor.w; x++) {
      const i = idx(floor, x, y);
      if (!floor.seen[i]) { row += " "; continue; }
      const t = floor.tiles[i]!;
      row += t === "wall" ? "#"
        : t === "door" ? "+"
        : t === "stairsDown" ? ">"
        : t === "stairsUp" ? "<"
        : ".";
    }
    rows.push(row);
  }
  const entities = floor.entities
    .filter((e) => floor.visible[idx(floor, e.x, e.y)] === 1 || (e.kind === "feature" && floor.seen[idx(floor, e.x, e.y)] === 1))
    .map((e) => ({ uid: e.uid, x: e.x, y: e.y, glyph: e.glyph, kind: e.kind, name: e.name }));
  return { rows, entities };
}

export { revealRoom };
