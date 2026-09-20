import type { EnemyId, ItemId, KnowledgeId, NpcId } from "../types.js";

/** Procedurally generated dungeon: rooms joined by corridors, one floor at a time. */

export type TileKind = "wall" | "floor" | "door" | "stairsDown" | "stairsUp";

export type RoomKind =
  | "entry" | "normal" | "stairs" | "treasure" | "shrine"
  | "ashdoor" | "npc" | "rest" | "shop" | "boss";

export interface Room {
  id: number;
  x: number; y: number; w: number; h: number;
  kind: RoomKind;
  seen: boolean;
}

export type FeatureKind =
  | "stairsDown" | "chest" | "altar" | "ashdoor" | "campfire" | "shop" | "lore";

export interface DungeonEntity {
  uid: string;
  kind: "enemy" | "item" | "feature" | "npc";
  x: number; y: number;
  /** enemy */
  pack?: EnemyId[];
  bossId?: EnemyId;
  awake?: boolean;
  sight?: number;
  /** item */
  itemId?: ItemId;
  /** feature */
  feature?: FeatureKind;
  knowledgeId?: KnowledgeId;
  used?: boolean;
  /** npc */
  npcId?: NpcId;
  glyph: string;
  name: string;
}

export interface Floor {
  depth: number;
  region: string;
  title: string;
  w: number; h: number;
  /** row-major, length w*h */
  tiles: TileKind[];
  /** room id per tile, -1 for corridor/wall */
  roomAt: Int16Array;
  rooms: Room[];
  entities: DungeonEntity[];
  /** explored memory */
  seen: Uint8Array;
  /** currently lit */
  visible: Uint8Array;
  entry: { x: number; y: number };
  stairs: { x: number; y: number };
  isBossFloor: boolean;
}

export const DUNGEON_DEPTH = 8;

/** Which existing region each stratum belongs to, so Knowledge keeps its hooks. */
export const STRATA: { depth: number; region: string; title: string }[] = [
  { depth: 1, region: "forest",    title: "森の根" },
  { depth: 2, region: "road",      title: "埋もれた街道" },
  { depth: 3, region: "graveyard", title: "墓所・外縁" },
  { depth: 4, region: "graveyard", title: "墓所・深層" },
  { depth: 5, region: "sewer",     title: "地下水路" },
  { depth: 6, region: "church",    title: "教会地下" },
  { depth: 7, region: "town",      title: "埋没した城下町" },
  { depth: 8, region: "castle",    title: "玉座の下" },
];

export function stratumFor(depth: number): { depth: number; region: string; title: string } {
  return STRATA[Math.min(Math.max(depth, 1), STRATA.length) - 1]!;
}

export const idx = (f: { w: number }, x: number, y: number): number => y * f.w + x;

export function tileAt(f: Floor, x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return "wall";
  return f.tiles[idx(f, x, y)]!;
}

export function walkable(f: Floor, x: number, y: number): boolean {
  return tileAt(f, x, y) !== "wall";
}

export function entityAt(f: Floor, x: number, y: number): DungeonEntity | undefined {
  return f.entities.find((e) => e.x === x && e.y === y);
}

export function roomIdAt(f: Floor, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return -1;
  return f.roomAt[idx(f, x, y)]!;
}
