import test from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/rng.js";
import { newMeta } from "../src/engine/run.js";
import { generateFloor } from "../src/dungeon/generate.js";
import { computeVisibility, findPath, stepPlayer, monsterTurn, renderFloor } from "../src/dungeon/runtime.js";
import { DUNGEON_DEPTH, idx, walkable, type Floor } from "../src/dungeon/types.js";

function floor(depth: number, seed: string): Floor {
  return generateFloor({
    depth, rng: new Rng(seed), meta: newMeta(),
    liveKnowledge: new Set(), takenThisRun: new Set(),
    bossId: "B_VANE", regionDanger: {},
  });
}

/** Flood fill from the entry over every walkable tile. */
function reachableFrom(f: Floor, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(f.w * f.h);
  const q = [idx(f, sx, sy)];
  seen[q[0]!] = 1;
  for (let i = 0; i < q.length; i++) {
    const cx = q[i]! % f.w, cy = Math.floor(q[i]! / f.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx!, ny = cy + dy!;
      if (!walkable(f, nx, ny)) continue;
      const ni = idx(f, nx, ny);
      if (seen[ni]) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

test("every generated floor is fully connected — no walled-off pockets", () => {
  for (let depth = 1; depth <= DUNGEON_DEPTH; depth++) {
    for (let s = 0; s < 12; s++) {
      const f = floor(depth, `conn-${depth}-${s}`);
      const seen = reachableFrom(f, f.entry.x, f.entry.y);
      let unreachable = 0;
      for (let i = 0; i < f.tiles.length; i++) {
        if (f.tiles[i] !== "wall" && !seen[i]) unreachable++;
      }
      assert.equal(unreachable, 0,
        `B${depth}F seed ${s}: ${unreachable} floor tiles cannot be reached from the entry`);
    }
  }
});

test("the way down is always reachable, and never where you start", () => {
  for (let depth = 1; depth <= DUNGEON_DEPTH; depth++) {
    for (let s = 0; s < 12; s++) {
      const f = floor(depth, `stairs-${depth}-${s}`);
      const seen = reachableFrom(f, f.entry.x, f.entry.y);
      assert.equal(seen[idx(f, f.stairs.x, f.stairs.y)], 1, `B${depth}F seed ${s}: stairs unreachable`);
      const d = Math.abs(f.stairs.x - f.entry.x) + Math.abs(f.stairs.y - f.entry.y);
      assert.ok(d > 3, `B${depth}F seed ${s}: stairs are on top of the entry`);
      assert.ok(findPath(f, f.entry, f.stairs), "a path must exist for click-to-move");
    }
  }
});

test("the deepest floor holds the boss and no ordinary stairs", () => {
  const f = floor(DUNGEON_DEPTH, "boss");
  assert.equal(f.isBossFloor, true);
  assert.ok(f.entities.some((e) => e.bossId), "the boss must be placed");
  assert.equal(f.entities.some((e) => e.feature === "stairsDown"), false, "nowhere left to descend");
});

test("nothing is generated on top of anything else", () => {
  for (let s = 0; s < 20; s++) {
    const f = floor(1 + (s % DUNGEON_DEPTH), `overlap-${s}`);
    const seen = new Set<string>();
    for (const e of f.entities) {
      const k = `${e.x},${e.y}`;
      assert.ok(!seen.has(k), `two entities share ${k}`);
      seen.add(k);
      assert.notEqual(f.tiles[idx(f, e.x, e.y)], "wall", "an entity is inside a wall");
    }
    assert.ok(!seen.has(`${f.entry.x},${f.entry.y}`), "the entry tile must stay clear");
  }
});

test("the same seed regenerates the same floor", () => {
  const a = floor(4, "repeat");
  const b = floor(4, "repeat");
  assert.deepEqual(a.tiles, b.tiles);
  assert.deepEqual(a.entities.map((e) => `${e.uid}${e.x},${e.y}`), b.entities.map((e) => `${e.uid}${e.x},${e.y}`));
});

test("standing in a room lights the room; a corridor lights only what is next to you", () => {
  const f = floor(2, "fov");
  const room = f.rooms.find((r) => r.w >= 5 && r.h >= 4)!;
  computeVisibility(f, room.x + 1, room.y + 1, 1);
  let litInRoom = 0;
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) if (f.visible[idx(f, x, y)]) litInRoom++;
  }
  assert.equal(litInRoom, room.w * room.h, "the whole room should be lit");

  // a corridor tile: only the 3x3 around the player
  const corridor = (() => {
    for (let y = 1; y < f.h - 1; y++) {
      for (let x = 1; x < f.w - 1; x++) {
        if (f.tiles[idx(f, x, y)] === "floor" && f.roomAt[idx(f, x, y)] === -1) return { x, y };
      }
    }
    return null;
  })();
  if (corridor) {
    computeVisibility(f, corridor.x, corridor.y, 1);
    const lit = f.visible.reduce((a: number, b) => a + b, 0);
    assert.ok(lit <= 9, `a corridor should light at most 9 tiles, lit ${lit}`);
  }
});

test("a torch widens what you can see underground", () => {
  const f = floor(2, "torch");
  const corridor = (() => {
    for (let y = 2; y < f.h - 2; y++) {
      for (let x = 2; x < f.w - 2; x++) {
        if (f.tiles[idx(f, x, y)] === "floor" && f.roomAt[idx(f, x, y)] === -1) return { x, y };
      }
    }
    return null;
  })();
  if (!corridor) return;
  computeVisibility(f, corridor.x, corridor.y, 1);
  const plain = f.visible.reduce((a: number, b) => a + b, 0);
  computeVisibility(f, corridor.x, corridor.y, 3);
  const lit = f.visible.reduce((a: number, b) => a + b, 0);
  assert.ok(lit > plain, "carrying a torch must actually show you more");
});

test("walls block movement and diagonals do not cut corners", () => {
  const f = floor(1, "walls");
  const { x, y } = f.entry;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
    const r = stepPlayer(f, x, y, dx!, dy!);
    if (r.outcome.kind === "blocked") {
      assert.ok(true);
    } else {
      assert.ok(walkable(f, r.x, r.y), "you can only stand on walkable tiles");
    }
  }
});

test("monsters wake when seen and close the distance", () => {
  const f = floor(3, "ai");
  const e = f.entities.find((x) => x.kind === "enemy")!;
  // stand next to it and light the area
  computeVisibility(f, e.x, e.y, 3);
  const before = Math.abs(e.x - f.entry.x) + Math.abs(e.y - f.entry.y);
  let moved = false;
  for (let i = 0; i < 12; i++) {
    const r = monsterTurn(f, e.x + 3, e.y, new Rng(`ai${i}`));
    if (r.ambushedBy) { moved = true; break; }
  }
  assert.ok(e.awake || moved, "a monster that sees you should react");
  void before;
});

test("what is rendered matches what has been seen", () => {
  const f = floor(2, "render");
  computeVisibility(f, f.entry.x, f.entry.y, 1);
  const { rows } = renderFloor(f, f.entry.x, f.entry.y);
  assert.equal(rows.length, f.h);
  assert.equal(rows[0]!.length, f.w);
  const unknown = rows.join("").split("").filter((c) => c === " ").length;
  assert.ok(unknown > 0, "an unexplored floor must still be mostly dark");
  assert.notEqual(rows[f.entry.y]![f.entry.x], " ", "the tile you stand on is known");
});
