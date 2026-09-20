import type {
  MetaState, RunState, KnowledgeId, KnowledgeEffect, Reliability,
  KnowledgeDef, SpecialAction, EnemyState,
} from "../types.js";
import { KNOWLEDGE, SYNTHESIS_RULES, getKnowledge } from "../content/knowledge.js";
import { WORLD_TRUTHS } from "../content/world.js";
import type { Rng } from "../rng.js";

/** How often an effect actually fires.  This is the whole paradox, numerically. */
export const RELIABILITY_PROC: Record<Reliability, number> = {
  confirmed: 1.0,
  uncertain: 0.75,
  rumor: 0.5,
  invalidated: 0.0,
};

export function reliabilityOf(meta: MetaState, id: KnowledgeId): Reliability | null {
  return meta.knowledge[id]?.reliability ?? null;
}

/** "Do we know this, and is it still true?" */
export function knows(meta: MetaState, id: KnowledgeId): boolean {
  const r = reliabilityOf(meta, id);
  return r !== null && r !== "invalidated";
}

export function heldIds(meta: MetaState): Set<KnowledgeId> {
  return new Set(Object.keys(meta.knowledge));
}

export interface Acquisition {
  id: KnowledgeId;
  def: KnowledgeDef;
  reliability: Reliability;
  synthesized: boolean;
  /** rule lines shown on the KNOWLEDGE ACQUIRED card */
  effectLabels: string[];
  upgradedFrom?: Reliability;
  truthsDisclosed: string[];
}

/**
 * Grant a piece of Knowledge.  It lands in MetaState immediately — the run does
 * not have to be survived (design §14.2).
 */
export function grantKnowledge(
  meta: MetaState,
  run: RunState | null,
  id: KnowledgeId,
  opts: { reliability?: Reliability; synthesized?: boolean } = {},
): Acquisition[] {
  const def = getKnowledge(id);
  const existing = meta.knowledge[id];
  const target = opts.reliability ?? def.baseReliability;
  const out: Acquisition[] = [];

  if (existing) {
    // Re-observing the same fact through another route upgrades confidence.
    if (existing.reliability === "invalidated") return out;
    const order: Reliability[] = ["rumor", "uncertain", "confirmed"];
    const cur = order.indexOf(existing.reliability);
    const next = Math.max(cur, order.indexOf(target));
    if (next > cur) {
      const from = existing.reliability;
      existing.reliability = order[next]!;
      out.push({
        id, def, reliability: existing.reliability, synthesized: false,
        effectLabels: def.effectLabels, upgradedFrom: from, truthsDisclosed: [],
      });
    }
    return out;
  }

  meta.knowledge[id] = {
    id,
    reliability: target,
    discoveredAtRun: meta.totalRuns,
  };
  if (run) run.knowledgeGainedThisRun.push(id);

  const truths = discloseTruths(meta, def.gameplayEffects);
  out.push({
    id, def, reliability: target, synthesized: opts.synthesized ?? false,
    effectLabels: def.effectLabels, truthsDisclosed: truths,
  });

  // K023 is a downgrade disguised as a discovery: knowing that Vane adapts
  // makes the lightning-weakness knowledge unreliable.
  if (id === "K023" && meta.knowledge["K009"]?.reliability === "confirmed") {
    meta.knowledge["K009"]!.reliability = "uncertain";
  }

  out.push(...runSynthesis(meta, run));
  return out;
}

/** Fires the instant both halves are held — no manual combining (SELF_REVIEW P5). */
export function runSynthesis(meta: MetaState, run: RunState | null): Acquisition[] {
  const out: Acquisition[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of SYNTHESIS_RULES) {
      if (meta.knowledge[rule.id]) continue;
      if (!rule.requires.every((r) => knows(meta, r))) continue;
      changed = true;
      const def = getKnowledge(rule.id);
      meta.knowledge[rule.id] = {
        id: rule.id, reliability: def.baseReliability, discoveredAtRun: meta.totalRuns,
      };
      if (run) { run.knowledgeGainedThisRun.push(rule.id); run.synthesizedThisRun.push(rule.id); }
      const truths = discloseTruths(meta, def.gameplayEffects);
      out.push({
        id: rule.id, def, reliability: def.baseReliability, synthesized: true,
        effectLabels: def.effectLabels, truthsDisclosed: truths,
      });
      if (rule.id === "K023" && meta.knowledge["K009"]?.reliability === "confirmed") {
        meta.knowledge["K009"]!.reliability = "uncertain";
      }
    }
  }
  return out;
}

function discloseTruths(meta: MetaState, effects: KnowledgeEffect[]): string[] {
  const out: string[] = [];
  for (const e of effects) {
    if (e.kind !== "discloseTruth") continue;
    if (meta.worldTruthDisclosure[e.truthId]) continue;
    meta.worldTruthDisclosure[e.truthId] = true;
    const t = WORLD_TRUTHS.find((w) => w.id === e.truthId);
    if (t) out.push(t.statement);
  }
  return out;
}

export function invalidate(meta: MetaState, ids: KnowledgeId[], by: string): KnowledgeId[] {
  const hit: KnowledgeId[] = [];
  for (const id of ids) {
    const rec = meta.knowledge[id];
    if (!rec || rec.reliability === "invalidated") continue;
    rec.reliability = "invalidated";
    rec.invalidatedBy = by;
    hit.push(id);
  }
  return hit;
}

/** Distortion erodes anything time-tabled: schedules stop being dependable. */
export function applyDistortionDecay(meta: MetaState): KnowledgeId[] {
  if (meta.distortion < 6) return [];
  const hit: KnowledgeId[] = [];
  for (const def of KNOWLEDGE) {
    if (!def.tags.includes("schedule")) continue;
    const rec = meta.knowledge[def.id];
    if (!rec || rec.reliability !== "confirmed") continue;
    rec.reliability = "uncertain";
    hit.push(def.id);
  }
  return hit;
}

/** Every effect currently in force, paired with the confidence behind it. */
export function activeEffects(meta: MetaState): { effect: KnowledgeEffect; id: KnowledgeId; reliability: Reliability }[] {
  const out: { effect: KnowledgeEffect; id: KnowledgeId; reliability: Reliability }[] = [];
  for (const [id, rec] of Object.entries(meta.knowledge)) {
    if (rec.reliability === "invalidated") continue;
    const def = KNOWLEDGE.find((k) => k.id === id);
    if (!def) continue;
    for (const effect of def.gameplayEffects) out.push({ effect, id, reliability: rec.reliability });
  }
  return out;
}

/**
 * Structural effects (route unlocks, revealed nodes, encounter conversions) are
 * rolled ONCE per run against reliability, at map-generation time.  An uncertain
 * schedule that fails its roll simply does not happen this run — which is
 * exactly what "uncertain" should feel like.
 */
export function rollStructural(meta: MetaState, rng: Rng): Set<KnowledgeId> {
  const live = new Set<KnowledgeId>();
  for (const [id, rec] of Object.entries(meta.knowledge)) {
    if (rec.reliability === "invalidated") continue;
    if (rng.chance(RELIABILITY_PROC[rec.reliability])) live.add(id);
  }
  return live;
}

export interface SpecialContext {
  meta: MetaState;
  run: RunState;
  enemies: EnemyState[];
  isBoss: boolean;
  bossId?: string;
  synergyFlags: Set<string>;
  hasItem: (id: string) => boolean;
  hasSkill: (id: string) => boolean;
}

/**
 * Knowledge-derived combat actions.  This is the payoff moment for §8:
 * knowledge shows up as an extra button, not as a paragraph.
 */
export function specialActionsFor(ctx: SpecialContext): SpecialAction[] {
  const out: SpecialAction[] = [];
  const push = (a: SpecialAction) => { if (!out.some((x) => x.id === a.id)) out.push(a); };
  const tags = new Set(ctx.enemies.flatMap((e) => e.tags));
  const bossAdapted = ctx.run.npcFlags["N02"]?.includes("adapted") ?? false;

  for (const { effect, id, reliability } of activeEffects(ctx.meta)) {
    if (effect.kind === "unlockSpecialAction") {
      if (effect.scope === "boss" && !ctx.isBoss) continue;
      if (effect.scope === "social") continue;

      if (effect.actionId === "SA_TORCH") {
        if (ctx.bossId !== "B_VANE") continue;
        if (!ctx.hasItem("I_TORCH") && !ctx.hasSkill("S07")) continue;
        push({
          id: "SA_TORCH", label: "松明を突きつける", source: id, sourceKind: "knowledge",
          reliability: bossAdapted ? "uncertain" : reliability,
          desc: bossAdapted
            ? "ヴェインは火に備えている。それでも一瞬は揺らぐかもしれない。"
            : "騎士団長に Fear 1 と Burn 6 を与える。",
        });
      }
      if (effect.actionId === "SA_EXPOSE_PRINCESS") {
        push({
          id: "SA_EXPOSE_PRINCESS", label: "「王女は偽物だ」と告げる", source: id, sourceKind: "knowledge",
          reliability,
          desc: ctx.bossId === "B_SELD"
            ? "影武者の盾を破壊し、Vulnerable 3 を与える。"
            : "Fear 1 を与え、Guard を全て剥がす。",
        });
      }
      if (effect.actionId === "SA_LIGHTNING") {
        if (!tags.has("phase2")) continue;
        if (!ctx.hasSkill("S11") && !ctx.hasItem("I_STORMVIAL")) continue;
        push({
          id: "SA_LIGHTNING", label: "雷を撃ち込む", source: id, sourceKind: "knowledge",
          reliability, desc: "第二形態に雷ダメージ 34（弱点 ×2 が乗る）。",
        });
      }
    }
    if (effect.kind === "enableNegotiation" && tags.has(effect.enemyTag)) {
      push({
        id: "SA_NEGOTIATE_KNOWN", label: "「お前たちは元騎士団だろう」", source: id, sourceKind: "knowledge",
        reliability, desc: "戦闘を終了させる。Silver Tongue は不要。",
      });
    }
    if (effect.kind === "itemEffect" && effect.effect === "instantKill") {
      if (!ctx.hasItem(effect.itemId)) continue;
      if (!ctx.enemies.some((e) => e.hp > 0 && e.tags.includes(effect.vs))) continue;
      push({
        id: "SA_HOLYWATER_KILL", label: "聖水を振りかける", source: id, sourceKind: "knowledge",
        reliability, desc: `${effect.vs} の敵 1 体を即死させる。`,
      });
    }
  }

  // Synergy-granted actions.
  if (ctx.synergyFlags.has("royalNegotiation") && ctx.isBoss) {
    const royal = Object.entries(ctx.meta.knowledge).some(([kid, rec]) => {
      if (rec.reliability === "invalidated") return false;
      return KNOWLEDGE.find((k) => k.id === kid)?.tags.includes("royal") ?? false;
    });
    if (royal) {
      push({
        id: "SA_ROYAL_DEAL", label: "王家の名において取引する", source: "Y03", sourceKind: "synergy",
        reliability: "confirmed", desc: "本来不可能な交渉。ボス戦そのものを終わらせる。",
      });
    }
  }
  if (ctx.synergyFlags.has("detonateStatuses")) {
    push({
      id: "SA_DETONATE", label: "嵐火 — 状態異常を起爆", source: "Y05", sourceKind: "synergy",
      reliability: "confirmed", desc: "対象の状態異常スタック合計 ×3 のダメージ。",
    });
  }
  return out;
}

/** Roll whether a knowledge-derived action actually works this time. */
export function procKnowledge(reliability: Reliability | undefined, rng: Rng): boolean {
  if (!reliability) return true;
  return rng.chance(RELIABILITY_PROC[reliability]);
}
