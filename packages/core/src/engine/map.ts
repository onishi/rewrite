import type { MapNode, RunMap, NodeKind, MetaState, KnowledgeId } from "../types.js";
import { Rng } from "../rng.js";
import { activeEffects } from "./knowledge.js";

/**
 * Layered node graph.  Layout, encounters, danger and reward hints are rolled
 * from the run seed; region names, act structure and world truths never change
 * (DESIGN §13.3) — "the map is random, the truth is not".
 */

interface RegionDef { id: string; jp: string; act: number; enemies: string[]; elites: string[]; }

const REGIONS: RegionDef[] = [
  { id: "forest", jp: "森", act: 1, enemies: ["E_DOG", "E_BANDIT"], elites: ["E_CAPTAIN"] },
  { id: "graveyard", jp: "墓地", act: 1, enemies: ["E_ROTSOLDIER", "E_DOG"], elites: ["E_BELLGHOST"] },
  { id: "road", jp: "街道", act: 1, enemies: ["E_BANDIT", "E_DOG"], elites: ["E_CAPTAIN"] },
  { id: "town", jp: "城下町", act: 2, enemies: ["E_KNIGHT", "E_BANDIT"], elites: ["E_CAPTAIN"] },
  { id: "sewer", jp: "地下水路", act: 2, enemies: ["E_LEECH", "E_ROTSOLDIER"], elites: ["E_BELLGHOST"] },
  { id: "church", jp: "教会", act: 2, enemies: ["E_ROTSOLDIER", "E_KNIGHT"], elites: ["E_BELLGHOST"] },
  { id: "castle", jp: "城", act: 3, enemies: ["E_KNIGHT", "E_KNIGHT"], elites: ["E_CAPTAIN"] },
];

const PLACE_NAMES: Record<string, string[]> = {
  forest: ["外縁", "霧の道", "炭焼き小屋", "倒木の谷"],
  graveyard: ["外縁", "納骨堂", "無縁墓", "鐘楼の影"],
  road: ["関所跡", "廃駅", "石橋", "行商の野営"],
  town: ["市場", "裏通り", "広場", "鍛冶通り"],
  sewer: ["入口", "合流点", "水没区画", "北の格子"],
  church: ["礼拝堂", "回廊", "鐘楼", "墓所前"],
  castle: ["外郭", "中庭", "広間", "回廊"],
};

/** Regions available per step index.  Steps 1-2 = act1, 3-5 = act2, 6-7 = act3. */
function regionsForStep(step: number): RegionDef[] {
  if (step <= 2) return REGIONS.filter((r) => r.act === 1);
  if (step <= 5) return REGIONS.filter((r) => r.act === 2);
  return REGIONS.filter((r) => r.act === 3);
}

/** Knowledge placement: which node type can carry which knowledge. */
const KNOWLEDGE_SITES: { id: KnowledgeId; region: string; kinds: NodeKind[] }[] = [
  { id: "K001", region: "forest", kinds: ["discovery"] },
  { id: "K002", region: "graveyard", kinds: ["discovery", "social"] },
  { id: "K003", region: "town", kinds: ["discovery"] },
  { id: "K004", region: "town", kinds: ["social", "discovery"] },
  { id: "K005", region: "church", kinds: ["discovery", "social"] },
  { id: "K006", region: "road", kinds: ["discovery"] },
  { id: "K007", region: "castle", kinds: ["ashdoor", "discovery"] },
  { id: "K008", region: "sewer", kinds: ["discovery"] },
  { id: "K010", region: "church", kinds: ["social", "shop"] },
  { id: "K011", region: "road", kinds: ["combat", "social"] },
  { id: "K012", region: "church", kinds: ["ashdoor", "discovery"] },
  { id: "K013", region: "castle", kinds: ["discovery", "social"] },
  { id: "K014", region: "church", kinds: ["social"] },
  { id: "K015", region: "graveyard", kinds: ["social"] },
  { id: "K016", region: "church", kinds: ["ashdoor"] },
  { id: "K019", region: "sewer", kinds: ["ashdoor"] },
  { id: "K018", region: "church", kinds: ["ashdoor"] },
];

const NPC_BY_REGION: Record<string, string> = {
  graveyard: "N04", church: "N03", town: "N02", castle: "N05", road: "N02", sewer: "N04", forest: "N01",
};

export interface MapGenOpts {
  meta: MetaState;
  rng: Rng;
  liveKnowledge: Set<KnowledgeId>;
  regionDanger: Record<string, number>;
  bossId: string;
}

export function generateMap(opts: MapGenOpts): RunMap {
  const { rng, meta, liveKnowledge, regionDanger } = opts;
  const steps: MapNode[][] = [];

  // Step 0 — the village hub.
  steps.push([{
    id: "NODE_VILLAGE", kind: "hub", name: "村アシュメア", region: "village",
    act: 0, step: 0, danger: 0, timeCost: 0, tags: ["village", "safe"],
    hints: ["休息", "会話", "準備"], npcId: "N01",
  }]);

  const knowledgePool = KNOWLEDGE_SITES.filter((s) => !meta.knowledge[s.id]);
  const placed = new Set<KnowledgeId>();
  const usedNames = new Set<string>();

  for (let step = 1; step <= 7; step++) {
    const regions = regionsForStep(step);
    const count = step >= 6 ? 2 : 3;
    const chosen = rng.sample(regions, Math.min(count, regions.length));
    const kinds = rollKinds(rng, chosen.length, step);
    const nodes: MapNode[] = [];

    for (let i = 0; i < chosen.length; i++) {
      const region = chosen[i]!;
      const kind = kinds[i]!;
      const names = PLACE_NAMES[region.id] ?? ["奥"];
      const free = names.filter((n) => !usedNames.has(`${region.id}:${n}`));
      const place = free.length > 0 ? rng.pick(free) : rng.pick(names);
      usedNames.add(`${region.id}:${place}`);
      const node: MapNode = {
        id: `N${step}_${region.id}_${i}`,
        kind, name: `${region.jp}・${place}`, region: region.id,
        act: region.act, step, danger: 0, timeCost: 120,
        tags: [region.id, kind], hints: [],
      };

      const dangerBase = kind === "elite" ? 3 : kind === "combat" ? 2 : kind === "ashdoor" ? 3 : 1;
      const shift = regionDanger[region.id] ?? 0;
      node.danger = Math.max(0, Math.min(3, dangerBase + shift)) as 0 | 1 | 2 | 3;

      switch (kind) {
        case "combat":
          node.enemyIds = rng.sample([...region.enemies, ...region.enemies], rng.int(1, step >= 4 ? 3 : 2));
          node.hints = ["Gold", "Skill 3択"];
          break;
        case "elite":
          node.enemyIds = [rng.pick(region.elites)];
          node.hints = ["Gold++", "レア Skill", "Item"];
          node.timeCost = 120;
          break;
        case "social":
          node.npcId = NPC_BY_REGION[region.id] ?? "N01";
          node.hints = ["会話", "Knowledge?"];
          break;
        case "discovery":
          node.hints = ["Knowledge 確定"];
          node.timeCost = 180;
          break;
        case "shop":
          node.hints = ["購入", "噂を買う"];
          node.timeCost = 60;
          break;
        case "shrine":
          node.hints = ["高リスク", "Skill or Knowledge"];
          node.timeCost = 60;
          break;
        case "rest":
          node.hints = ["HP 回復 40%"];
          node.timeCost = 180;
          break;
        case "ashdoor":
          node.name = `${region.jp}・灰の扉`;
          node.hints = ["Knowledge 確定", "レア Item", "入室時 HP −25%"];
          node.timeCost = 180;
          break;
      }

      // Place undiscovered knowledge on matching nodes.
      const site = knowledgePool.find(
        (s) => !placed.has(s.id) && s.region === region.id && s.kinds.includes(kind),
      );
      if (site) { node.knowledgeId = site.id; placed.add(site.id); }

      // Knowledge that converts an encounter into a conversation.
      for (const { effect, id } of activeEffects(meta)) {
        if (effect.kind !== "convertEncounter") continue;
        if (!liveKnowledge.has(id)) continue;
        if (effect.nodeTag === "gravekeeper" && region.id === "graveyard" && (kind === "combat" || kind === "elite")) {
          node.kind = "social";
          node.npcId = "N04";
          node.convertedBy = id;
          node.danger = 0;
          node.hints = ["会話", "Knowledge?", "戦闘回避"];
        }
      }

      // Time-cost knowledge.
      for (const { effect, id } of activeEffects(meta)) {
        if (effect.kind === "timeCost" && liveKnowledge.has(id) && node.tags.includes(effect.nodeTag)) {
          node.timeCost = Math.max(30, node.timeCost + effect.delta);
          node.hints.push(`時間 ${effect.delta / 60}h`);
        }
      }
      nodes.push(node);
    }

    // Knowledge-revealed secret nodes appear as an extra, strictly better option.
    for (const { effect, id } of activeEffects(meta)) {
      if (effect.kind !== "revealNode" || !liveKnowledge.has(id)) continue;
      const secret = secretNode(effect.nodeId, step, meta);
      if (secret) { secret.revealedByKnowledge = id; nodes.push(secret); }
    }

    // K008: the well shortcut skips a whole castle step.
    if (step === 6) {
      for (const { effect, id } of activeEffects(meta)) {
        if (effect.kind !== "unlockRoute" || effect.from !== "sewer" || !liveKnowledge.has(id)) continue;
        nodes.push({
          id: "NODE_WELL", kind: "discovery", name: "城・井戸の底", region: "castle",
          act: 3, step, danger: 1, timeCost: 120, tags: ["castle", "shortcut"],
          hints: ["近道（1ステップ短縮）", "Knowledge?"], revealedByKnowledge: id,
        });
      }
    }
    // The step before the boss always offers a fire to sit at.  The whole
    // point is the choice: heal up, or spend the last hours on one more secret.
    if (step === 7 && !nodes.some((n) => n.kind === "rest")) {
      nodes.push({
        id: "NODE_LASTFIRE", kind: "rest", name: "城・篝火", region: "castle",
        act: 3, step, danger: 0, timeCost: 120, tags: ["castle", "rest"],
        hints: ["HP 回復 40%", "ボス前最後の休息"],
      });
    }
    steps.push(nodes);
  }

  steps.push([{
    id: "NODE_BOSS", kind: "boss", name: "対決", region: "castle",
    act: 4, step: 8, danger: 3, timeCost: 0, tags: ["boss"], hints: ["Boss"],
  }]);

  return { steps, bossId: opts.bossId };
}

function rollKinds(rng: Rng, n: number, step: number): NodeKind[] {
  // At most half the offered nodes are fights, so a run stays inside 20-25 min.
  const pool: { item: NodeKind; weight: number }[] = [
    { item: "combat", weight: 30 },
    { item: "social", weight: 16 },
    { item: "discovery", weight: 16 },
    { item: "shop", weight: 10 },
    { item: "shrine", weight: 8 },
    { item: "rest", weight: 10 },
    { item: "ashdoor", weight: step >= 3 ? 10 : 3 },
    { item: "elite", weight: step >= 4 ? 12 : 4 },
  ];
  const out: NodeKind[] = [];
  let fights = 0;
  for (let i = 0; i < n; i++) {
    let kind = rng.weighted(pool);
    if ((kind === "combat" || kind === "elite") && fights >= Math.ceil(n / 2)) {
      kind = rng.weighted(pool.filter((p) => p.item !== "combat" && p.item !== "elite"));
    }
    if (out.includes(kind) && kind !== "combat") {
      kind = rng.weighted(pool.filter((p) => !out.includes(p.item)));
    }
    if (kind === "combat" || kind === "elite") fights++;
    out.push(kind);
  }
  return out;
}

function secretNode(nodeId: string, step: number, meta: MetaState): MapNode | null {
  const table: Record<string, { step: number; node: Omit<MapNode, "step"> }> = {
    NODE_INN_CELLAR: {
      step: 1,
      node: { id: "NODE_INN_CELLAR", kind: "discovery", name: "宿屋の地下", region: "village",
        act: 1, danger: 1, timeCost: 60, tags: ["village", "secret"],
        hints: ["Knowledge 確定", "毒の出所"], knowledgeId: "K024" },
    },
    NODE_CHURCH_NIGHT: {
      step: 5,
      node: { id: "NODE_CHURCH_NIGHT", kind: "social", name: "教会・裏口（22時）", region: "church",
        act: 2, danger: 2, timeCost: 120, tags: ["church", "night", "secret"],
        hints: ["尾行", "Knowledge"], npcId: "N02", knowledgeId: "K017" },
    },
    NODE_INN_EMPTY: {
      step: 1,
      node: { id: "NODE_INN_EMPTY", kind: "discovery", name: "無人の宿屋（22時）", region: "village",
        act: 1, danger: 1, timeCost: 60, tags: ["village", "night", "secret"],
        hints: ["侵入", "Knowledge"], knowledgeId: "K003" },
    },
    NODE_CHURCH_UNDER: {
      step: 4,
      node: { id: "NODE_CHURCH_UNDER", kind: "discovery", name: "教会・地下書庫", region: "church",
        act: 2, danger: 1, timeCost: 120, tags: ["church", "secret"],
        hints: ["Knowledge 確定", "世界の真実"], knowledgeId: "K016" },
    },
    NODE_ASH_TOWER: {
      step: 7,
      node: { id: "NODE_ASH_TOWER", kind: "discovery", name: "灰の塔・門", region: "tower",
        act: 3, danger: 2, timeCost: 120, tags: ["tower", "secret"],
        hints: ["Knowledge 確定", "灰の鍵が必要"], knowledgeId: "K018" },
    },
    NODE_SECRET_MEETING: {
      step: 5,
      node: { id: "NODE_SECRET_MEETING", kind: "ashdoor", name: "教会・密会（22時）", region: "church",
        act: 2, danger: 3, timeCost: 120, tags: ["church", "night", "secret", "meeting"],
        hints: ["Knowledge 確定", "極めて危険"], knowledgeId: "K014" },
    },
  };
  const entry = table[nodeId];
  if (!entry || entry.step !== step) return null;
  if (entry.node.knowledgeId && meta.knowledge[entry.node.knowledgeId]) {
    // Already known — the node still exists but carries a different payoff.
    return { ...entry.node, step, knowledgeId: undefined, hints: ["Item", "Gold"] } as MapNode;
  }
  return { ...entry.node, step } as MapNode;
}

export const PURGE_NODE: MapNode = {
  id: "NODE_PURGE", kind: "elite", name: "城下町・粛清", region: "town",
  act: 2, step: 4, danger: 3, timeCost: 120, tags: ["town", "purge", "injected"],
  hints: ["Run 1 には存在しなかった事件", "Gold++", "レア Skill"],
  enemyIds: ["E_CAPTAIN", "E_KNIGHT"],
};
