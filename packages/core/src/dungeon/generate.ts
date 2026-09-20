import type { Floor, Room, RoomKind, DungeonEntity, TileKind } from "./types.js";
import { idx, stratumFor, DUNGEON_DEPTH } from "./types.js";
import type { MetaState, KnowledgeId } from "../types.js";
import { Rng } from "../rng.js";
import { activeEffects } from "../engine/knowledge.js";
import { ITEMS } from "../content/world.js";

/**
 * Room-and-corridor floor generation.
 *
 * Fully seeded: the same (seed, depth) always yields the same floor, which is
 * what lets a Run be replayed and what keeps `npm run sim` a real regression
 * test.  Layout, encounters and loot are random; which Knowledge can be found
 * in which stratum is not (DESIGN §13.3 — "the map is random, the truth is not").
 */

const ENEMIES_BY_REGION: Record<string, string[]> = {
  forest: ["E_DOG", "E_BANDIT"],
  road: ["E_BANDIT", "E_DOG"],
  graveyard: ["E_ROTSOLDIER", "E_DOG"],
  sewer: ["E_LEECH", "E_ROTSOLDIER"],
  church: ["E_ROTSOLDIER", "E_KNIGHT"],
  town: ["E_KNIGHT", "E_BANDIT"],
  castle: ["E_KNIGHT", "E_KNIGHT"],
};

const ELITES_BY_REGION: Record<string, string> = {
  forest: "E_CAPTAIN", road: "E_CAPTAIN", graveyard: "E_BELLGHOST",
  sewer: "E_BELLGHOST", church: "E_BELLGHOST", town: "E_CAPTAIN", castle: "E_CAPTAIN",
};

const NPC_BY_REGION: Record<string, string> = {
  forest: "N01", road: "N02", graveyard: "N04",
  sewer: "N04", church: "N03", town: "N02", castle: "N05",
};

/** Knowledge is findable only in the stratum its fiction belongs to. */
const KNOWLEDGE_SITES: { id: KnowledgeId; region: string }[] = [
  { id: "K001", region: "forest" },
  { id: "K006", region: "road" },
  { id: "K011", region: "road" },
  { id: "K002", region: "graveyard" },
  { id: "K015", region: "graveyard" },
  // the crypt records sit directly under the graveyard, so the trail to the
  // church's secret starts shallow enough to find in an early run
  { id: "K012", region: "graveyard" },
  { id: "K010", region: "church" },
  { id: "K008", region: "sewer" },
  { id: "K019", region: "sewer" },
  { id: "K005", region: "church" },
  { id: "K012", region: "church" },
  { id: "K014", region: "church" },
  { id: "K016", region: "church" },
  { id: "K003", region: "town" },
  { id: "K004", region: "town" },
  { id: "K018", region: "town" },
  { id: "K007", region: "castle" },
  { id: "K013", region: "castle" },
];

interface Rect { x: number; y: number; w: number; h: number; }

function overlaps(a: Rect, b: Rect, pad = 2): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x
      && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

const centre = (r: Rect): { x: number; y: number } => ({
  x: r.x + Math.floor(r.w / 2),
  y: r.y + Math.floor(r.h / 2),
});

export interface FloorGenOpts {
  depth: number;
  rng: Rng;
  meta: MetaState;
  /** knowledge whose structural effect passed its reliability roll this run */
  liveKnowledge: Set<KnowledgeId>;
  /** knowledge already collected earlier in this same run */
  takenThisRun: Set<KnowledgeId>;
  bossId: string;
  /** extra danger applied by REWRITE consequences */
  regionDanger: Record<string, number>;
}

export function generateFloor(opts: FloorGenOpts): Floor {
  const { depth, rng, meta } = opts;
  const stratum = stratumFor(depth);
  const isBossFloor = depth >= DUNGEON_DEPTH;

  const w = 41 + (depth % 3) * 4;
  const h = 23 + (depth % 2) * 4;
  const tiles: TileKind[] = new Array(w * h).fill("wall");
  const roomAt = new Int16Array(w * h).fill(-1);

  const floor: Floor = {
    depth, region: stratum.region, title: stratum.title,
    w, h, tiles, roomAt, rooms: [], entities: [],
    seen: new Uint8Array(w * h), visible: new Uint8Array(w * h),
    entry: { x: 1, y: 1 }, stairs: { x: 1, y: 1 }, isBossFloor,
  };

  // ---------------------------------------------------------------- rooms
  const rects: Rect[] = [];
  const target = isBossFloor ? 5 : rng.int(6, 9);
  for (let attempt = 0; attempt < 220 && rects.length < target; attempt++) {
    const rw = rng.int(5, isBossFloor ? 11 : 9);
    const rh = rng.int(4, isBossFloor ? 8 : 6);
    const r: Rect = {
      x: rng.int(1, w - rw - 2),
      y: rng.int(1, h - rh - 2),
      w: rw, h: rh,
    };
    if (rects.some((o) => overlaps(r, o))) continue;
    rects.push(r);
  }

  rects.forEach((r, i) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        tiles[idx(floor, x, y)] = "floor";
        roomAt[idx(floor, x, y)] = i;
      }
    }
    floor.rooms.push({ id: i, ...r, kind: "normal", seen: false });
  });

  // ------------------------------------------------------------ corridors
  const carve = (x: number, y: number): void => {
    if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return;
    if (tiles[idx(floor, x, y)] === "wall") tiles[idx(floor, x, y)] = "floor";
  };
  const connect = (a: Rect, b: Rect): void => {
    const p = centre(a), q = centre(b);
    if (rng.chance(0.5)) {
      for (let x = Math.min(p.x, q.x); x <= Math.max(p.x, q.x); x++) carve(x, p.y);
      for (let y = Math.min(p.y, q.y); y <= Math.max(p.y, q.y); y++) carve(q.x, y);
    } else {
      for (let y = Math.min(p.y, q.y); y <= Math.max(p.y, q.y); y++) carve(p.x, y);
      for (let x = Math.min(p.x, q.x); x <= Math.max(p.x, q.x); x++) carve(x, q.y);
    }
  };
  for (let i = 1; i < rects.length; i++) connect(rects[i - 1]!, rects[i]!);
  // a couple of loops so the floor is not a pure tree
  const extra = isBossFloor ? 1 : rng.int(1, 2);
  for (let i = 0; i < extra && rects.length > 2; i++) {
    const a = rng.int(0, rects.length - 1);
    let b = rng.int(0, rects.length - 1);
    if (a === b) b = (b + 1) % rects.length;
    connect(rects[a]!, rects[b]!);
  }

  // doors where a corridor meets a room edge
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (tiles[idx(floor, x, y)] !== "floor") continue;
      if (roomAt[idx(floor, x, y)] !== -1) continue;
      const nRoom = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .filter(([dx, dy]) => roomAt[idx(floor, x + dx!, y + dy!)] !== -1).length;
      if (nRoom === 1) tiles[idx(floor, x, y)] = "door";
    }
  }

  // ------------------------------------------------------------ room roles
  const entryRoom = floor.rooms[0]!;
  entryRoom.kind = "entry";
  floor.entry = centre(entryRoom);

  let far = floor.rooms[floor.rooms.length - 1]!;
  let bestD = -1;
  for (const r of floor.rooms) {
    if (r.kind === "entry") continue;
    const c = centre(r);
    const d = Math.abs(c.x - floor.entry.x) + Math.abs(c.y - floor.entry.y);
    if (d > bestD) { bestD = d; far = r; }
  }
  far.kind = isBossFloor ? "boss" : "stairs";
  floor.stairs = centre(far);

  const spare = rng.shuffle(floor.rooms.filter((r) => r.kind === "normal"));
  const roles: RoomKind[] = [];
  if (!isBossFloor) {
    roles.push("treasure");
    if (rng.chance(0.55)) roles.push("shrine");
    if (rng.chance(depth >= 3 ? 0.5 : 0.2)) roles.push("ashdoor");
    if (rng.chance(0.45)) roles.push("npc");
    if (rng.chance(0.4)) roles.push("rest");
    if (rng.chance(0.3)) roles.push("shop");
  } else {
    roles.push("rest");
  }
  roles.forEach((k, i) => { if (spare[i]) spare[i]!.kind = k; });

  // ------------------------------------------------------------- entities
  let uid = 0;
  const nextUid = (): string => `e${depth}_${uid++}`;
  const occupied = new Set<string>([`${floor.entry.x},${floor.entry.y}`]);
  const freeSpotIn = (r: Room, tries = 24): { x: number; y: number } | null => {
    for (let i = 0; i < tries; i++) {
      const x = rng.int(r.x, r.x + r.w - 1);
      const y = rng.int(r.y, r.y + r.h - 1);
      const key = `${x},${y}`;
      if (occupied.has(key)) continue;
      if (tiles[idx(floor, x, y)] !== "floor") continue;
      occupied.add(key);
      return { x, y };
    }
    return null;
  };

  const push = (e: Omit<DungeonEntity, "uid">): void => {
    floor.entities.push({ uid: nextUid(), ...e });
  };

  // stairs / boss
  if (isBossFloor) {
    push({
      kind: "enemy", x: floor.stairs.x, y: floor.stairs.y,
      bossId: opts.bossId, awake: true, sight: 99,
      glyph: "Ω", name: "対決",
    });
    occupied.add(`${floor.stairs.x},${floor.stairs.y}`);
  } else {
    tiles[idx(floor, floor.stairs.x, floor.stairs.y)] = "stairsDown";
    push({
      kind: "feature", x: floor.stairs.x, y: floor.stairs.y,
      feature: "stairsDown", glyph: ">", name: "下り階段",
    });
    occupied.add(`${floor.stairs.x},${floor.stairs.y}`);
  }

  // one Knowledge site per floor, drawn from this stratum's fiction
  const site = KNOWLEDGE_SITES.find(
    (s) => s.region === stratum.region && !meta.knowledge[s.id] && !opts.takenThisRun.has(s.id),
  );
  const loreRooms = floor.rooms.filter((r) => ["treasure", "ashdoor", "npc", "shrine"].includes(r.kind));
  if (site) {
    // Keep the stratum's own clue on an ordinary lore spot.  Ash doors are left
    // to hand out whatever is still unknown, which is how a secret that lives
    // eight floors down can be bought early — with blood.
    const host = loreRooms.find((r) => r.kind !== "ashdoor")
      ?? spare.find((r) => r.kind === "normal") ?? loreRooms[0] ?? floor.rooms[1];
    const spot = host ? freeSpotIn(host) : null;
    if (spot) {
      const inAshdoor = host!.kind === "ashdoor";
      push({
        kind: "feature", x: spot.x, y: spot.y,
        feature: inAshdoor ? "ashdoor" : "lore",
        knowledgeId: site.id,
        glyph: inAshdoor ? "▒" : "!",
        name: inAshdoor ? "灰の扉" : "手がかり",
      });
    }
  }

  // room features
  for (const r of floor.rooms) {
    const spot = (): { x: number; y: number } | null => freeSpotIn(r);
    if (r.kind === "shrine") {
      const p = spot(); if (p) push({ kind: "feature", x: p.x, y: p.y, feature: "altar", glyph: "Ψ", name: "祭壇" });
    }
    if (r.kind === "rest") {
      const p = spot(); if (p) push({ kind: "feature", x: p.x, y: p.y, feature: "campfire", glyph: "≡", name: "篝火" });
    }
    if (r.kind === "shop") {
      const p = spot(); if (p) push({ kind: "feature", x: p.x, y: p.y, feature: "shop", glyph: "$", name: "行商人" });
    }
    if (r.kind === "treasure") {
      for (let i = 0; i < rng.int(1, 2); i++) {
        const p = spot(); if (p) push({ kind: "feature", x: p.x, y: p.y, feature: "chest", glyph: "◇", name: "宝箱" });
      }
    }
    if (r.kind === "ashdoor" && !floor.entities.some((e) => e.feature === "ashdoor")) {
      const p = spot();
      if (p) push({ kind: "feature", x: p.x, y: p.y, feature: "ashdoor", glyph: "▒", name: "灰の扉" });
    }
    if (r.kind === "npc") {
      const p = spot();
      const npcId = NPC_BY_REGION[stratum.region] ?? "N01";
      if (p) push({ kind: "npc", x: p.x, y: p.y, npcId, glyph: "@", name: "人影" });
    }
  }

  // loose items
  const itemPool = ITEMS.filter((i) => i.price > 0 && i.rarity !== "rare").map((i) => i.id);
  for (let i = 0; i < rng.int(1, 3); i++) {
    const r = rng.pick(floor.rooms.filter((x) => x.kind !== "entry"));
    const p = freeSpotIn(r);
    if (p) push({ kind: "item", x: p.x, y: p.y, itemId: rng.pick(itemPool), glyph: "(", name: "落ちている道具" });
  }

  // wandering enemies
  const danger = opts.regionDanger[stratum.region] ?? 0;
  const pool = ENEMIES_BY_REGION[stratum.region] ?? ["E_DOG"];
  const count = isBossFloor ? 2 : Math.max(2, Math.min(7, 2 + Math.floor(depth * 0.7) + danger));
  for (let i = 0; i < count; i++) {
    const candidates = floor.rooms.filter((r) => r.kind !== "entry" && r.kind !== "boss");
    if (candidates.length === 0) break;
    const r = rng.pick(candidates);
    const p = freeSpotIn(r);
    if (!p) continue;
    const eliteChance = depth >= 3 ? 0.18 + danger * 0.05 : 0.06;
    const isElite = rng.chance(eliteChance);
    const pack = isElite
      ? [ELITES_BY_REGION[stratum.region] ?? "E_CAPTAIN"]
      : rng.sample([...pool, ...pool], rng.int(1, depth >= 4 ? 3 : 2));
    push({
      kind: "enemy", x: p.x, y: p.y, pack, awake: false,
      sight: isElite ? 7 : 5,
      glyph: isElite ? "E" : "e",
      name: isElite ? "強敵の気配" : "敵の気配",
    });
  }

  // Knowledge that reveals things puts them on the map from the start.
  applyKnowledgeReveals(floor, opts);
  return floor;
}

/**
 * Structural Knowledge effects, resolved at generation time: a shortcut that
 * skips a floor, a secret room already marked, a stratum that costs less to
 * cross.  Effects only apply if their reliability roll passed this run.
 */
function applyKnowledgeReveals(floor: Floor, opts: FloorGenOpts): void {
  for (const { effect, id } of activeEffects(opts.meta)) {
    if (!opts.liveKnowledge.has(id)) continue;

    if (effect.kind === "unlockRoute" && effect.from === floor.region && effect.stepsSaved > 0) {
      // K008: the well drops you a whole floor.
      const r = floor.rooms.find((x) => x.kind === "stairs" || x.kind === "normal");
      if (!r) continue;
      const c = { x: r.x + 1, y: r.y + 1 };
      if (floor.entities.some((e) => e.x === c.x && e.y === c.y)) continue;
      floor.tiles[idx(floor, c.x, c.y)] = "stairsDown";
      floor.entities.push({
        uid: `shortcut${floor.depth}`, kind: "feature", x: c.x, y: c.y,
        feature: "stairsDown", glyph: "≫", name: "井戸の抜け道（1階層スキップ）",
        knowledgeId: id,
      });
    }

    if (effect.kind === "revealNode") {
      // Secret knowledge marks its room as already explored.
      const r = floor.rooms.find((x) => x.kind === "treasure" || x.kind === "ashdoor");
      if (!r || r.seen) continue;
      revealRoom(floor, r);
    }

    if (effect.kind === "convertEncounter" && effect.nodeTag === "gravekeeper" && floor.region === "graveyard") {
      // K002: the gravekeeper stops being a fight.
      const e = floor.entities.find((x) => x.kind === "enemy" && !x.bossId);
      if (e) {
        e.kind = "npc"; e.npcId = "N04"; e.glyph = "@";
        e.name = "墓守ネル"; e.knowledgeId = id;
        delete e.pack;
      }
    }
  }
}

export function revealRoom(floor: Floor, room: { x: number; y: number; w: number; h: number; seen?: boolean }): void {
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      if (x < 0 || y < 0 || x >= floor.w || y >= floor.h) continue;
      floor.seen[idx(floor, x, y)] = 1;
    }
  }
  if ("seen" in room) room.seen = true;
}
