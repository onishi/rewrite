import type {
  MetaState, RunState, PlayerState, MapNode, RewardOffer, Scene, SceneChoice,
  RunReport, RewriteDef, KnowledgeId, EndingId, LogEntry, WorldDelta,
} from "../types.js";
import { Rng } from "../rng.js";
import { SKILLS, getSkill, activeSynergies, synergyHintFor, SYNERGIES } from "../content/skills.js";
import { ITEMS, getItem, NPC_BY_ID, ENDINGS, WORLD_TRUTHS } from "../content/world.js";
import { REWRITES, REWRITE_BY_ID, getBoss } from "../content/enemies.js";
import { getKnowledge, KNOWLEDGE, nearSynthesis } from "../content/knowledge.js";
import {
  grantKnowledge, knows, invalidate, rollStructural, applyDistortionDecay,
  runSynthesis, reliabilityOf, type Acquisition,
} from "./knowledge.js";
import { generateMap, PURGE_NODE } from "./map.js";
import {
  startCombat, playerAction, combatRewards, refreshSpecials,
  type CombatContext, type PlayerAction, type ActionResult,
} from "./combat.js";

export const RUN_START_CLOCK = 6 * 60;
export const RUN_DEADLINE = 24 * 60;

const XP_TABLE = [0, 25, 60, 110, 175, 255, 350];

export function newMeta(): MetaState {
  return {
    totalRuns: 0, knowledge: {}, worldTruthDisclosure: {}, distortion: 0,
    executedRewrites: [], unlockedEndings: [], firstSeenLocations: [],
    bestSynergyEver: null, npcDejaVu: {}, unlockedSkillPool: [],
  };
}

export function clockString(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function log(run: RunState, text: string, kind: LogEntry["kind"] = "info"): void {
  run.log.push({ clock: run.clock, text, kind });
}

// ------------------------------------------------------------------- run start
export function startRun(meta: MetaState, seed: string): RunState {
  meta.totalRuns += 1;
  const rng = new Rng(seed);

  applyDistortionDecay(meta);
  runSynthesis(meta, null);
  const liveKnowledge = rollStructural(meta, rng.fork("structural"));

  const starters = rng.sample(SKILLS.filter((s) => s.pool !== "explore").map((s) => s.id), 2);
  const player: PlayerState = {
    hp: 70, maxHp: 70, focus: 3, maxFocus: 5, guard: 0,
    level: 1, xp: 0, gold: 40, power: 8,
    skills: starters, items: ["I_BANDAGE"], statuses: [], echoes: [], flags: {},
  };

  const bossId = meta.executedRewrites.includes("RW03") || meta.executedRewrites.includes("RW02")
    ? "B_SELD" : "B_VANE";

  const run: RunState = {
    runNumber: meta.totalRuns, seed,
    clock: RUN_START_CLOCK,
    player,
    map: generateMap({ meta, rng: rng.fork("map"), liveKnowledge, regionDanger: {}, bossId }),
    step: 0, currentNodeId: "NODE_VILLAGE", visited: [],
    npcTrust: {}, npcFlags: {}, deadNpcs: [], suspicion: 0,
    activeSynergies: activeSynergies(starters).map((s) => s.id),
    worldDeltas: [], knowledgeGainedThisRun: [], synthesizedThisRun: [], firstSeenThisRun: [],
    combat: null, pendingReward: null, pendingScene: null,
    log: [], outcome: "running",
    regionDanger: {}, freeActionsLeft: 3, routeUnlocks: [],
  };

  // Archivist's Loop promotes one shaky fact at the start of every run.
  if (player.skills.includes("S20")) {
    const shaky = Object.values(meta.knowledge).find((k) => k.reliability === "uncertain");
    if (shaky) { shaky.reliability = "confirmed"; log(run, `記録の環: ${getKnowledge(shaky.id).title} が Confirmed になった`, "knowledge"); }
  }

  log(run, `RUN ${run.runNumber} — 村アシュメア`, "info");
  run.pendingScene = villageScene(meta, run);
  return run;
}

export function rngFor(run: RunState, tag: string): Rng {
  return new Rng(`${run.seed}:${tag}:${run.clock}:${run.visited.length}`);
}

function ctxFor(meta: MetaState, run: RunState, tag: string): CombatContext {
  return { meta, run, rng: rngFor(run, tag) };
}

// ------------------------------------------------------------------- village
export const VILLAGE_ACTION_BUDGET = 3;

function villageScene(meta: MetaState, run: RunState): Scene {
  const left = VILLAGE_ACTION_BUDGET - (run.player.flags["villageActions"] ?? 0);
  const choices: SceneChoice[] = [];
  if (left > 0) {
    choices.push(
      { actionId: "VILLAGE_REST", label: `宿で休む（HP +20 / 1h）  あと ${left} 回` },
      { actionId: "VILLAGE_ASK", label: `噂を聞く（Knowledge の手がかり / 1h）  あと ${left} 回` },
      { actionId: "VILLAGE_SHOP", label: `買い物をする（0h）  あと ${left} 回` },
    );
  }
  choices.push({ actionId: "VILLAGE_LEAVE", label: "村を出る" });
  for (const rw of availableRewrites(meta, run)) {
    choices.unshift({ actionId: `REWRITE:${rw.id}`, label: `▶ REWRITE — ${rw.title}` });
  }
  return {
    nodeId: "NODE_VILLAGE", title: "村アシュメア",
    narrative: run.runNumber === 1
      ? "霧の薄い朝。宿の窓から灯りが漏れている。今日という日は、まだ何も決まっていない。"
      : `${run.runNumber} 度目の朝。同じ霧、同じ灯り。違うのは、あなたが知っていることだけだ。`,
    speaker: "N01", dialogue: dejaVuLine(meta, "N01"),
    choices, allowFreeAction: true,
  };
}

export function dejaVuStage(meta: MetaState, npcId: string): number {
  const npc = NPC_BY_ID.get(npcId);
  if (!npc) return 0;
  if (meta.totalRuns < npc.dejaVuFromRun) return 0;
  const over = meta.totalRuns - npc.dejaVuFromRun;
  return Math.min(npc.dejaVuLines.length - 1, 1 + Math.floor(over / 3));
}

function dejaVuLine(meta: MetaState, npcId: string): string {
  const npc = NPC_BY_ID.get(npcId);
  if (!npc) return "";
  return npc.dejaVuLines[dejaVuStage(meta, npcId)] ?? npc.dejaVuLines[0]!;
}

// ------------------------------------------------------------------- rewrites
export function availableRewrites(meta: MetaState, run: RunState): RewriteDef[] {
  return REWRITES.filter((rw) => {
    if (run.worldDeltas.some((d) => d.rewriteId === rw.id)) return false;
    if (!rw.requires.every((k) => knows(meta, k))) return false;
    if (rw.requiresConfirmed && !rw.requiresConfirmed.every((k) => reliabilityOf(meta, k) === "confirmed")) return false;
    if (run.deadNpcs.includes(rw.targetNpc)) return false;
    return true;
  });
}

/**
 * Apply a REWRITE.  Every consequence here is authored in data — the LLM gets
 * to narrate this, never to decide it (DESIGN §15).
 */
export function applyRewrite(meta: MetaState, run: RunState, rewriteId: string): {
  delta: WorldDelta; invalidated: KnowledgeId[]; lines: string[];
} {
  const rw = REWRITE_BY_ID.get(rewriteId);
  if (!rw) throw new Error(`unknown rewrite ${rewriteId}`);
  const lines: string[] = [];
  const invalidated: KnowledgeId[] = [];
  let regenerate = false;

  const cost = run.player.skills.includes("S20") ? Math.max(0, rw.timeCost - 60) : rw.timeCost;
  run.clock += cost;

  for (const eff of rw.effects) {
    switch (eff.kind) {
      case "cancelScheduledEvent":
        lines.push(`予定されていた出来事が消滅した（${eff.eventId}）`); regenerate = true; break;
      case "npcFlag":
        (run.npcFlags[eff.npc] ??= []).push(eff.flag); break;
      case "injectNode": {
        regenerate = true;
        run.npcFlags["__inject"] = [...(run.npcFlags["__inject"] ?? []), eff.nodeId];
        lines.push("本来存在しなかった出来事が発生しようとしている"); break;
      }
      case "removeNode":
        run.npcFlags["__remove"] = [...(run.npcFlags["__remove"] ?? []), eff.nodeId];
        regenerate = true; break;
      case "invalidate": {
        const hit = invalidate(meta, eff.knowledge, rw.id);
        invalidated.push(...hit);
        for (const id of hit) lines.push(`⚠ ${getKnowledge(id).title} — この未来はもう存在しない`);
        break;
      }
      case "trust":
        run.npcTrust[eff.npc] = (run.npcTrust[eff.npc] ?? 0) + eff.delta; break;
      case "suspicion":
        run.suspicion += run.player.items.includes("I_FALSECREST") ? Math.ceil(eff.delta / 2) : eff.delta; break;
      case "distortion":
        meta.distortion += eff.delta;
        if (meta.distortion >= 5 && !meta.knowledge["K019"]) grantKnowledge(meta, run, "K019");
        break;
      case "swapBoss":
        run.bossOverride = eff.to; run.map.bossId = eff.to;
        lines.push(`対決すべき相手が変わった: ${getBoss(eff.to).jp}`); break;
      case "dangerShift":
        run.regionDanger[eff.region] = (run.regionDanger[eff.region] ?? 0) + eff.delta;
        lines.push(`${eff.region} の危険度 ${eff.delta > 0 ? "+" : ""}${eff.delta}`);
        regenerate = true; break;
      case "grantItem":
        run.player.items.push(eff.item); lines.push(`${getItem(eff.item).jp} を手に入れた`); break;
      case "unlockRoute":
        run.routeUnlocks.push(eff.routeId); lines.push(`新しいルートが開いた: ${eff.routeId}`); break;
      case "allyNextFight":
        run.player.flags["ally"] = 1; lines.push("次の戦闘に味方が加わる"); break;
      case "killNpc":
        run.deadNpcs.push(eff.npc);
        lines.push(`${NPC_BY_ID.get(eff.npc)?.jp ?? eff.npc} はもういない`); break;
    }
  }

  const delta: WorldDelta = {
    rewriteId: rw.id, atClock: run.clock, effects: rw.effects,
    summary: `${rw.title} — ${rw.utterance}`,
  };
  run.worldDeltas.push(delta);
  if (!meta.executedRewrites.includes(rw.id)) meta.executedRewrites.push(rw.id);
  log(run, `REWRITE: ${rw.title}`, "rewrite");
  for (const l of lines) log(run, l, "rewrite");

  if (regenerate) regenerateFrom(meta, run, Math.max(1, run.step + 1));
  return { delta, invalidated, lines };
}

/** The world re-plans itself from the current step onward. */
function regenerateFrom(meta: MetaState, run: RunState, fromStep: number): void {
  const rng = new Rng(`${run.seed}:regen:${run.worldDeltas.length}`);
  const live = rollStructural(meta, rng.fork("structural"));
  const fresh = generateMap({
    meta, rng: rng.fork("map"), liveKnowledge: live,
    regionDanger: run.regionDanger, bossId: run.map.bossId,
  });
  const remove = new Set(run.npcFlags["__remove"] ?? []);
  const inject = run.npcFlags["__inject"] ?? [];

  for (let s = fromStep; s < run.map.steps.length - 1; s++) {
    let nodes = (fresh.steps[s] ?? []).filter((n) => !remove.has(n.id));
    if (inject.includes("NODE_PURGE") && s === 4) {
      nodes = [{ ...PURGE_NODE, step: s }, ...nodes.slice(0, 2)];
    }
    if (inject.includes("NODE_CHURCH_UNDER") && s === 4 && !nodes.some((n) => n.id === "NODE_CHURCH_UNDER")) {
      nodes = [...nodes.slice(0, 2), {
        id: "NODE_CHURCH_UNDER", kind: "discovery", name: "教会・地下書庫", region: "church",
        act: 2, step: s, danger: 1, timeCost: 120, tags: ["church", "secret"],
        hints: ["Knowledge 確定"], knowledgeId: meta.knowledge["K016"] ? undefined : "K016",
      }];
    }
    if (nodes.length === 0) nodes = fresh.steps[s] ?? [];
    run.map.steps[s] = nodes;
  }
}

// ------------------------------------------------------------------- movement
export function nodeOptions(run: RunState): MapNode[] {
  if (run.step + 1 >= run.map.steps.length) return run.map.steps[run.map.steps.length - 1]!;
  return run.map.steps[run.step + 1] ?? [];
}

export interface EnterResult {
  scene?: Scene;
  combatStarted?: boolean;
  acquisitions?: Acquisition[];
  reward?: RewardOffer;
  lines: string[];
}

export function enterNode(meta: MetaState, run: RunState, nodeId: string): EnterResult {
  const node = nodeOptions(run).find((n) => n.id === nodeId);
  if (!node) return { lines: ["そのノードへは行けない"] };
  const lines: string[] = [];

  run.step += 1;
  run.currentNodeId = node.id;
  run.visited.push(node.id);

  let time = node.timeCost;
  if (run.player.items.includes("I_ASHWATCH")) time = Math.max(30, time - 30);
  if (run.player.skills.includes("S17") && run.player.flags["echoStepUsed"] !== 1 && time >= 120) {
    run.player.flags["echoStepUsed"] = 1; time = Math.max(30, time - 120);
    lines.push("残響歩法: 移動時間を 2h 短縮した");
  }
  if (run.player.skills.includes("S09") && (node.kind === "discovery" || node.kind === "ashdoor")) {
    time = 0; lines.push("記録者: この寄り道に時間はかからなかった");
  }
  run.clock += time;

  if (!meta.firstSeenLocations.includes(node.region)) {
    meta.firstSeenLocations.push(node.region);
    run.firstSeenThisRun.push(node.name);
  } else if (!run.firstSeenThisRun.includes(node.name) && node.tags.includes("secret")) {
    run.firstSeenThisRun.push(node.name);
  }

  // Exploration is a real progression path, not a detour off the power curve.
  if (node.kind !== "combat" && node.kind !== "elite" && node.kind !== "boss" && node.kind !== "hub") {
    gainXp(run, node.kind === "ashdoor" ? 14 : node.kind === "discovery" ? 10 : 8);
  }

  log(run, node.name, "info");
  if (node.convertedBy) {
    lines.push(`Knowledge により戦闘を回避: ${getKnowledge(node.convertedBy).title}`);
    log(run, lines[lines.length - 1]!, "knowledge");
  }

  // The well shortcut eats a whole step of the castle approach.
  if (node.tags.includes("shortcut")) {
    run.step += 1;
    lines.push("井戸の底から城へ。ひとつ手前の関門を飛ばした（2h 節約）");
  }

  if (node.kind === "boss" || run.step >= run.map.steps.length - 1) {
    return { ...startBoss(meta, run), lines };
  }

  switch (node.kind) {
    case "combat":
    case "elite": {
      const ctx = ctxFor(meta, run, "combat");
      run.combat = startCombat(ctx, { enemyIds: node.enemyIds ?? ["E_DOG"] });
      return { combatStarted: true, lines };
    }
    default: {
      const r = buildScene(meta, run, node);
      run.pendingScene = r.scene ?? null;
      return { ...r, lines: [...lines, ...r.lines] };
    }
  }
}

export function startBoss(meta: MetaState, run: RunState): EnterResult {
  const lines: string[] = [];
  run.step = run.map.steps.length - 1;
  run.currentNodeId = "NODE_BOSS";
  let bossId = run.map.bossId;

  // Vane leaves the board entirely if you sent the princess running.
  if (bossId === "B_VANE" && run.worldDeltas.some((d) => d.rewriteId === "RW03")) bossId = "B_SELD";
  // The tower route overrides everything: with the key and the knowledge of
  // what sits at the top, you climb instead of settling the local conspiracy.
  if (run.player.items.includes("I_GRAVEKEY") && knows(meta, "K018")) {
    bossId = "B_WRITER";
    run.map.bossId = bossId;
    lines.push("灰の鍵が門を開く。あなたは事件ではなく、塔を選んだ。");
  }
  if (run.deadNpcs.includes(getBoss(bossId).npcId)) {
    lines.push(`${getBoss(bossId).jp} はもういない。対決は起きなかった。`);
    run.outcome = "cleared";
    return { lines };
  }
  if (run.clock > RUN_DEADLINE) {
    const penalty = Math.floor(run.player.hp * 0.25);
    run.player.hp = Math.max(1, run.player.hp - penalty);
    lines.push(`日付が変わった。消耗したまま対峙することになる（HP −${penalty}）`);
  }
  const ctx = ctxFor(meta, run, "boss");
  run.combat = startCombat(ctx, { bossId });
  log(run, `BOSS: ${getBoss(bossId).jp}`, "danger");
  return { combatStarted: true, lines };
}

// ------------------------------------------------------------------- combat glue
export function doCombatAction(meta: MetaState, run: RunState, action: PlayerAction): ActionResult & {
  resolved?: boolean; reward?: RewardOffer; acquisitions?: Acquisition[];
} {
  if (!run.combat) return { ok: false, message: "戦闘中ではない", lines: [], endedTurn: false };
  const ctx = ctxFor(meta, run, `act${run.combat.turn}`);
  const res = playerAction(ctx, run.combat, action);
  if (!res.ok) return res;

  const c = run.combat;
  if (c.phase === "won" || c.phase === "fled") {
    const out = finishCombat(meta, run, c.phase === "fled");
    return { ...res, resolved: true, ...out };
  }
  if (c.phase === "lost") {
    const out = onDeath(meta, run, c.isBoss ? `${getBoss(c.bossId!).jp} に敗れた` : "戦闘で倒れた", c.bossId);
    return { ...res, resolved: true, acquisitions: out };
  }
  return res;
}

function finishCombat(meta: MetaState, run: RunState, fled: boolean): { reward?: RewardOffer; acquisitions?: Acquisition[] } {
  const c = run.combat!;
  const wasBoss = c.isBoss;
  const ctx = ctxFor(meta, run, "loot");
  const acquisitions: Acquisition[] = [];

  if (!fled) {
    const { gold, xp } = combatRewards(ctx, c);
    run.player.gold += gold;
    gainXp(run, xp);
    log(run, `勝利 — Gold +${gold} / XP +${xp}`, "reward");
  } else {
    run.clock += 60;
    log(run, "戦闘を回避した（1h）", "info");
  }
  run.player.flags["ally"] = 0;
  run.combat = null;

  if (wasBoss) {
    run.outcome = "cleared";
    const ending = resolveEnding(meta, run);
    if (ending) log(run, `ENDING: ${ENDINGS.find((e) => e.id === ending)?.name}`, "info");
    return { acquisitions };
  }

  const node = currentNode(run);
  if (node?.knowledgeId && !fled) {
    acquisitions.push(...grantKnowledge(meta, run, node.knowledgeId));
  }
  const reward = offerSkillReward(meta, run, node?.kind === "elite" ? "rare" : "normal");
  run.pendingReward = reward;
  return { reward, acquisitions };
}

export function currentNode(run: RunState): MapNode | null {
  for (const step of run.map.steps) {
    const n = step.find((x) => x.id === run.currentNodeId);
    if (n) return n;
  }
  return null;
}

function gainXp(run: RunState, xp: number): void {
  run.player.xp += xp;
  while (run.player.level < XP_TABLE.length && run.player.xp >= (XP_TABLE[run.player.level] ?? Infinity)) {
    run.player.level += 1;
    run.player.maxHp += 10;
    run.player.hp = Math.min(run.player.maxHp, run.player.hp + 14);
    run.player.power += 3;
    log(run, `LEVEL ${run.player.level}`, "reward");
  }
}

// ------------------------------------------------------------------- rewards
export function offerSkillReward(meta: MetaState, run: RunState, tier: "normal" | "rare" | "explore"): RewardOffer {
  const rng = rngFor(run, `reward${run.visited.length}`);
  const owned = new Set(run.player.skills);
  const pool = SKILLS.filter((s) => !owned.has(s.id) && (tier === "explore" ? s.pool !== "combat" : s.pool !== "explore"));
  let picks = rng.sample(pool.map((s) => s.id), 3);

  // "Rumour of a skill" bought at a shop guarantees a synergy piece.
  if (run.player.flags["synergyTip"] === 1) {
    run.player.flags["synergyTip"] = 0;
    const wanted = pool.map((s) => s.id).filter((id) => synergyHintFor(id, run.player.skills));
    if (wanted.length > 0) {
      const forced = rng.pick(wanted);
      if (!picks.includes(forced)) picks[0] = forced;
    }
  }
  const synergyHints: Record<number, string> = {};
  picks.forEach((id, i) => {
    const h = synergyHintFor(id, run.player.skills);
    if (h) synergyHints[i] = h;
  });
  return { kind: "skill", skillIds: picks, synergyHints };
}

export function takeReward(meta: MetaState, run: RunState, choice: string | null): string[] {
  const lines: string[] = [];
  const offer = run.pendingReward;
  run.pendingReward = null;
  if (!offer || !choice) return ["何も取らなかった"];
  if (offer.kind === "skill" && offer.skillIds?.includes(choice)) {
    run.player.skills.push(choice);
    lines.push(`${getSkill(choice).jp} を習得した`);
    const before = new Set(run.activeSynergies);
    const formed = activeSynergies(run.player.skills).map((x) => x.id);
    run.activeSynergies = [...run.activeSynergies, ...formed.filter((x) => !before.has(x))];
    for (const s of formed) {
      if (before.has(s)) continue;
      const def = SYNERGIES.find((x) => x.id === s)!;
      lines.push(`⚡ SYNERGY 成立: ${def.jp} — ${def.desc}`);
      meta.bestSynergyEver = def.jp;
      log(run, `SYNERGY ${def.jp}`, "reward");
    }
  } else if (offer.kind === "item" && offer.itemIds?.includes(choice)) {
    run.player.items.push(choice);
    lines.push(`${getItem(choice).jp} を手に入れた`);
  }
  for (const l of lines) log(run, l, "reward");
  return lines;
}

// ------------------------------------------------------------------- scenes
export function buildScene(meta: MetaState, run: RunState, node: MapNode): EnterResult {
  const lines: string[] = [];
  const acquisitions: Acquisition[] = [];
  const choices: SceneChoice[] = [];
  const hasPremonition = run.player.skills.includes("S03");
  let narrative = "";
  let title = node.name;
  let speaker: string | undefined;
  let dialogue: string | undefined;

  switch (node.kind) {
    case "discovery": {
      narrative = "誰も見ていない。調べる時間はある。";
      choices.push({ actionId: "DISC_TAKE", label: "調べる（Knowledge）", dangerHint: hasPremonition ? "safe" : undefined });
      choices.push({ actionId: "DISC_FAST", label: "素通りする（時間を戻す）", dangerHint: hasPremonition ? "safe" : undefined });
      break;
    }
    case "ashdoor": {
      narrative = "扉の隙間から灰がこぼれている。中に何かがあるのは間違いない。";
      const cost = Math.floor(run.player.hp * 0.25);
      choices.push({ actionId: "ASH_ENTER", label: `扉を開ける（HP −${cost}）`, dangerHint: hasPremonition ? (run.player.hp - cost <= 10 ? "lethal" : "risky") : undefined });
      choices.push({ actionId: "ASH_SKIP", label: "引き返す", dangerHint: hasPremonition ? "safe" : undefined });
      if (run.player.skills.includes("S05")) {
        choices.push({ actionId: "ASH_BLOOD", label: "血の代償で強引に開ける（HP −12・確実）", dangerHint: hasPremonition ? "risky" : undefined });
      }
      break;
    }
    case "shop": {
      narrative = "商人が荷を広げている。";
      const rng = rngFor(run, `shop${run.step}`);
      const stock = rng.sample(ITEMS.filter((i) => i.price > 0).map((i) => i.id), 4);
      for (const id of stock) {
        const item = getItem(id);
        const price = run.player.skills.includes("S04") ? Math.floor(item.price * 0.8) : item.price;
        choices.push({
          actionId: `BUY:${id}:${price}`, label: `${item.jp} — ${price}G（${item.desc}）`,
          locked: run.player.gold < price, lockReason: "Gold が足りない",
        });
      }
      choices.push({ actionId: "BUY_TIP:60", label: "求めるスキルの噂を買う — 60G（次の3択にシナジー枠が確定で混ざる）", locked: run.player.gold < 60, lockReason: "Gold が足りない" });
      if (run.player.skills.includes("S10")) choices.push({ actionId: "SHOP_STEAL", label: "盗む（Suspicion +2 のリスク）" });
      choices.push({ actionId: "LEAVE", label: "立ち去る" });
      break;
    }
    case "shrine": {
      narrative = "古い祭壇。捧げるものを求めている。";
      choices.push({ actionId: "SHRINE_HP", label: `HP を 25% 捧げる（レア Skill 3択）`, dangerHint: hasPremonition ? "risky" : undefined });
      choices.push({ actionId: "SHRINE_GOLD", label: "Gold 50 を捧げる（Item）", locked: run.player.gold < 50, lockReason: "Gold が足りない" });
      choices.push({ actionId: "LEAVE", label: "何も捧げない" });
      break;
    }
    case "rest": {
      narrative = "火を起こせる場所がある。";
      choices.push({ actionId: "REST_HEAL", label: `休む（HP +${Math.floor(run.player.maxHp * 0.4)}）` });
      choices.push({ actionId: "REST_TRAIN", label: "鍛える（最大 HP +6 / 攻撃力 +2）" });
      break;
    }
    case "social": {
      const npcId = node.npcId ?? "N01";
      const npc = NPC_BY_ID.get(npcId)!;
      speaker = npcId;
      title = `${node.name} — ${npc.jp}`;
      narrative = run.deadNpcs.includes(npcId)
        ? `${npc.jp} の姿はない。` : `${npc.jp} がこちらを見た。`;
      dialogue = dejaVuLine(meta, npcId);
      choices.push({ actionId: "TALK", label: "話を聞く" });
      if (run.player.skills.includes("S01") && npc.lies.length > 0) {
        choices.push({ actionId: "LIE_EYE", label: `［嘘看破］「それは嘘だ」`, requiresSkill: "S01" });
      }
      if (run.player.skills.includes("S13")) {
        choices.push({ actionId: "EMPATH", label: `［共感］本当の目的を読む`, requiresSkill: "S13" });
      }
      if (run.player.skills.includes("S02")) {
        choices.push({ actionId: "NECRO", label: `［死霊術］近くの死者に聞く`, requiresSkill: "S02" });
      }
      if (npcId === "N03" && knows(meta, "K014")) {
        choices.push({ actionId: "PRESS_PRIEST", label: "［K014］入れ替わりについて問い詰める", requiresKnowledge: "K014" });
      }
      for (const rw of availableRewrites(meta, run)) {
        if (rw.targetNpc !== npcId) continue;
        choices.push({ actionId: `REWRITE:${rw.id}`, label: `▶ REWRITE — ${rw.title}` });
      }
      choices.push({ actionId: "LEAVE", label: "立ち去る" });
      break;
    }
    default:
      narrative = "特に何もない。";
      choices.push({ actionId: "LEAVE", label: "進む" });
  }

  return {
    scene: {
      nodeId: node.id, title, narrative, speaker, dialogue,
      choices, allowFreeAction: node.kind !== "shop",
    },
    acquisitions, lines,
  };
}

export interface ChoiceResult {
  lines: string[];
  acquisitions: Acquisition[];
  reward?: RewardOffer;
  sceneClosed: boolean;
  combatStarted?: boolean;
  rewriteApplied?: string;
}

export function resolveChoice(meta: MetaState, run: RunState, actionId: string): ChoiceResult {
  const lines: string[] = [];
  const acquisitions: Acquisition[] = [];
  const node = currentNode(run);
  const rng = rngFor(run, `choice${run.step}:${actionId}`);
  let sceneClosed = true;
  let reward: RewardOffer | undefined;
  let rewriteApplied: string | undefined;

  if (actionId.startsWith("REWRITE:")) {
    const id = actionId.slice(8);
    const res = applyRewrite(meta, run, id);
    lines.push(`REWRITE — ${REWRITE_BY_ID.get(id)!.utterance}`, ...res.lines);
    rewriteApplied = id;
    sceneClosed = false;
    if (run.pendingScene) {
      run.pendingScene.choices = run.pendingScene.choices.filter((c) => c.actionId !== actionId);
    }
    return { lines, acquisitions, sceneClosed, rewriteApplied };
  }
  if (actionId.startsWith("BUY:")) {
    const [, itemId, priceStr] = actionId.split(":");
    const price = Number(priceStr);
    if (run.player.gold >= price) {
      run.player.gold -= price;
      run.player.items.push(itemId!);
      applyRelic(run, itemId!);
      lines.push(`${getItem(itemId!).jp} を買った（−${price}G）`);
    } else lines.push("Gold が足りない");
    if (run.pendingScene) run.pendingScene.choices = run.pendingScene.choices.filter((c) => c.actionId !== actionId);
    return { lines, acquisitions, sceneClosed: false };
  }
  if (actionId.startsWith("BUY_TIP:")) {
    const price = Number(actionId.split(":")[1]);
    if (run.player.gold >= price) {
      run.player.gold -= price;
      run.player.flags["synergyTip"] = 1;
      lines.push("「その組み合わせを探しているなら、次の戦いのあとに見つかるはずだ」");
    } else lines.push("Gold が足りない");
    return { lines, acquisitions, sceneClosed: false };
  }

  if (actionId.startsWith("VILLAGE_") && actionId !== "VILLAGE_LEAVE") {
    run.player.flags["villageActions"] = (run.player.flags["villageActions"] ?? 0) + 1;
  }

  switch (actionId) {
    case "VILLAGE_REST":
      run.clock += 60; run.player.hp = Math.min(run.player.maxHp, run.player.hp + 20);
      lines.push("少し休んだ（HP +20）"); sceneClosed = false; break;
    case "VILLAGE_ASK": {
      run.clock += 60;
      const hint = nearSynthesis(new Set(Object.keys(meta.knowledge)));
      if (hint.length > 0) {
        lines.push(`「${getKnowledge(hint[0]!.missing[0]!).title.slice(0, 10)}……そんな話を聞いたことがある」`);
        lines.push(`（${getKnowledge(hint[0]!.id).title} まであと 1 つ）`);
      } else lines.push("「今日は静かなものだ」");
      sceneClosed = false; break;
    }
    case "VILLAGE_SHOP": {
      const stock = rng.sample(ITEMS.filter((i) => i.price > 0 && i.rarity !== "rare").map((i) => i.id), 3);
      if (run.pendingScene) {
        for (const id of stock) {
          const item = getItem(id);
          run.pendingScene.choices.unshift({
            actionId: `BUY:${id}:${item.price}`, label: `${item.jp} — ${item.price}G`,
            locked: run.player.gold < item.price, lockReason: "Gold が足りない",
          });
        }
        run.pendingScene.choices = run.pendingScene.choices.filter((c) => c.actionId !== "VILLAGE_SHOP");
      }
      lines.push("荷を広げてもらった"); sceneClosed = false; break;
    }
    case "VILLAGE_LEAVE":
      lines.push("村を出た"); break;
    case "DISC_TAKE": {
      if (node?.knowledgeId) {
        acquisitions.push(...grantKnowledge(meta, run, node.knowledgeId));
        if (run.player.skills.includes("S09")) {
          const extra = KNOWLEDGE.find((k) => !meta.knowledge[k.id] && !k.synthesizedFrom);
          if (extra) { acquisitions.push(...grantKnowledge(meta, run, extra.id, { reliability: "rumor" })); lines.push("記録者: もう1つ書き留めた"); }
        }
      } else {
        const g = rng.int(20, 45); run.player.gold += g; lines.push(`めぼしいものはなかった（Gold +${g}）`);
      }
      break;
    }
    case "DISC_FAST":
      run.clock -= 60; lines.push("何も調べずに進んだ（1h 取り戻した）"); break;
    case "ASH_ENTER":
    case "ASH_BLOOD": {
      const cost = actionId === "ASH_BLOOD" ? 12 : Math.floor(run.player.hp * 0.25);
      run.player.hp = Math.max(1, run.player.hp - cost);
      lines.push(`灰の扉をくぐった（HP −${cost}）`);
      if (node?.knowledgeId) acquisitions.push(...grantKnowledge(meta, run, node.knowledgeId));
      else {
        const unknown = KNOWLEDGE.filter((k) => !meta.knowledge[k.id] && !k.synthesizedFrom);
        if (unknown.length > 0) acquisitions.push(...grantKnowledge(meta, run, rng.pick(unknown).id));
      }
      const item = rng.pick(ITEMS.filter((i) => i.rarity !== "common"));
      run.player.items.push(item.id); applyRelic(run, item.id);
      lines.push(`${item.jp} を見つけた`);
      if (run.player.hp <= 1 && rng.chance(0.3)) {
        onDeath(meta, run, "灰の扉の向こうで力尽きた");
        lines.push("……ここまでだった。");
      }
      break;
    }
    case "ASH_SKIP": lines.push("扉は閉じたままにした"); break;
    case "SHOP_STEAL": {
      if (rng.chance(0.6)) {
        const item = rng.pick(ITEMS.filter((i) => i.price > 0));
        run.player.items.push(item.id); applyRelic(run, item.id);
        lines.push(`${item.jp} を盗んだ`);
      } else { run.suspicion += 2; lines.push("見られた（Suspicion +2）"); }
      sceneClosed = false; break;
    }
    case "SHRINE_HP": {
      const cost = Math.floor(run.player.hp * 0.25);
      run.player.hp = Math.max(1, run.player.hp - cost);
      lines.push(`血を捧げた（HP −${cost}）`);
      reward = offerSkillReward(meta, run, "rare"); run.pendingReward = reward; break;
    }
    case "SHRINE_GOLD": {
      run.player.gold -= 50;
      const item = rng.pick(ITEMS.filter((i) => i.rarity !== "common"));
      run.player.items.push(item.id); applyRelic(run, item.id);
      lines.push(`${item.jp} が現れた`); break;
    }
    case "REST_HEAL":
      run.player.hp = Math.min(run.player.maxHp, run.player.hp + Math.floor(run.player.maxHp * 0.4));
      lines.push("火の前で休んだ"); break;
    case "REST_TRAIN":
      run.player.maxHp += 6; run.player.hp += 6; run.player.power += 2;
      lines.push("型を確かめた（最大 HP +6 / 攻撃力 +2）"); break;
    case "TALK": {
      const npcId = node?.npcId ?? "N01";
      const npc = NPC_BY_ID.get(npcId)!;
      lines.push(`「${npc.publicGoal}。それだけだ」`);
      if (node?.knowledgeId && rng.chance(run.player.items.includes("I_EAVESDROP") ? 0.9 : 0.6)) {
        acquisitions.push(...grantKnowledge(meta, run, node.knowledgeId, { reliability: "uncertain" }));
      } else if (node?.knowledgeId) {
        lines.push("（もう少し踏み込めば何か聞けたかもしれない）");
      }
      break;
    }
    case "LIE_EYE": {
      const npcId = node?.npcId ?? "N01";
      const npc = NPC_BY_ID.get(npcId)!;
      lines.push(`［嘘看破］「${npc.lies[0] ?? "……"}」— それは嘘だ。`);
      if (node?.knowledgeId) acquisitions.push(...grantKnowledge(meta, run, node.knowledgeId, { reliability: "confirmed" }));
      run.npcTrust[npcId] = (run.npcTrust[npcId] ?? 0) - 1;
      break;
    }
    case "EMPATH": {
      const npcId = node?.npcId ?? "N01";
      const npc = NPC_BY_ID.get(npcId)!;
      lines.push(`［共感］この人物が本当に望んでいるのは —「${npc.trueGoal}」`);
      if (node?.knowledgeId) acquisitions.push(...grantKnowledge(meta, run, node.knowledgeId, { reliability: "uncertain" }));
      break;
    }
    case "NECRO": {
      const confirmed = run.activeSynergies.includes("Y01");
      lines.push(confirmed
        ? "［死者の嘘］死者は生前についた嘘まで吐き出した。"
        : "［死霊術］死者が途切れ途切れに答える。");
      const unknown = KNOWLEDGE.filter((k) => !meta.knowledge[k.id] && !k.synthesizedFrom);
      if (unknown.length > 0) {
        acquisitions.push(...grantKnowledge(meta, run, rng.pick(unknown).id, { reliability: confirmed ? "confirmed" : "uncertain" }));
      }
      break;
    }
    case "PRESS_PRIEST": {
      lines.push("「……あの方は、もうおられません」");
      acquisitions.push(...grantKnowledge(meta, run, "K007", { reliability: "confirmed" }));
      run.npcTrust["N03"] = (run.npcTrust["N03"] ?? 0) - 2;
      break;
    }
    case "LEAVE": lines.push("先へ進んだ"); break;
    default: lines.push("……"); break;
  }

  // The hub has a small action budget: it is a staging area, not a place to idle.
  if (run.pendingScene?.nodeId === "NODE_VILLAGE" && !sceneClosed) {
    const left = VILLAGE_ACTION_BUDGET - (run.player.flags["villageActions"] ?? 0);
    run.pendingScene.choices = run.pendingScene.choices.filter(
      (c) => !c.actionId.startsWith("VILLAGE_") || c.actionId === "VILLAGE_LEAVE" || left > 0,
    );
    for (const c of run.pendingScene.choices) {
      if (c.actionId.startsWith("VILLAGE_") && c.actionId !== "VILLAGE_LEAVE") {
        c.label = c.label.replace(/あと \d+ 回/, `あと ${left} 回`);
      }
    }
  }

  if (sceneClosed) run.pendingScene = null;
  for (const l of lines) log(run, l, "info");
  for (const a of acquisitions) log(run, `KNOWLEDGE: ${a.def.title}`, "knowledge");
  return { lines, acquisitions, reward, sceneClosed };
}

function applyRelic(run: RunState, itemId: string): void {
  switch (itemId) {
    case "I_IRONCHARM": run.player.maxHp += 12; run.player.hp += 12; break;
    case "I_WHETSTONE": run.player.power += 3; break;
    case "I_FOCUSRING": run.player.maxFocus += 2; break;
  }
}

// ------------------------------------------------------------------- death
export function onDeath(meta: MetaState, run: RunState, cause: string, bossId?: string): Acquisition[] {
  if (run.outcome !== "running") return [];
  run.outcome = "dead";
  run.deathCause = cause;
  run.combat = null;
  const acquisitions: Acquisition[] = [];

  // Losing to a boss always teaches you something (SELF_REVIEW Q5-3).
  if (bossId) {
    const k = getBoss(bossId).consolationKnowledge;
    if (!meta.knowledge[k]) acquisitions.push(...grantKnowledge(meta, run, k));
  }
  // Martyr's Bargain / Posthumous Papers turn dying into a harvest.
  if (run.activeSynergies.includes("Y08")) {
    for (const id of run.knowledgeGainedThisRun) {
      const rec = meta.knowledge[id];
      if (rec && rec.reliability === "uncertain") rec.reliability = "confirmed";
    }
    log(run, "遺稿: この Run で得た不確かな知識が全て確定した", "knowledge");
  } else if (run.player.skills.includes("S18")) {
    const shaky = Object.values(meta.knowledge).find((k) => k.reliability === "uncertain");
    if (shaky) { shaky.reliability = "confirmed"; log(run, `殉教者の取引: ${getKnowledge(shaky.id).title} が確定した`, "knowledge"); }
  }
  log(run, cause, "danger");
  return acquisitions;
}

function resolveEnding(meta: MetaState, run: RunState): EndingId | undefined {
  const boss = run.map.bossId;
  let ending: EndingId | undefined;
  if (boss === "B_WRITER") ending = "E3";
  else if (boss === "B_SELD" && (knows(meta, "K007") || knows(meta, "K022"))) ending = "E2";
  else ending = "E1";
  if (ending && !meta.unlockedEndings.includes(ending)) meta.unlockedEndings.push(ending);
  return ending;
}

// ------------------------------------------------------------------- report
export function buildReport(meta: MetaState, run: RunState): RunReport {
  const newK = run.knowledgeGainedThisRun.map((id) => {
    const def = getKnowledge(id);
    return {
      id, title: def.title,
      synthesized: run.synthesizedThisRun.includes(id),
      effects: def.effectLabels,
    };
  });

  const nextRunUnlocks: string[] = [];
  const heldAfter = new Set(Object.keys(meta.knowledge));
  for (const rw of REWRITES) {
    if (meta.executedRewrites.includes(rw.id)) continue;
    if (!rw.requires.every((k) => knows(meta, k))) continue;
    nextRunUnlocks.push(`REWRITE「${rw.title}」が解禁されました`);
  }
  const bossActions = newK.flatMap((k) => k.effects.filter((e) => e.includes("ボス戦")));
  if (bossActions.length > 0) nextRunUnlocks.push(`ボス戦の選択肢が ${bossActions.length} つ増えます`);
  for (const k of newK) {
    for (const e of k.effects) {
      if (e.includes("出現") || e.includes("ショートカット") || e.includes("回避") || e.includes("×2")) {
        nextRunUnlocks.push(e);
      }
    }
  }
  for (const hint of nearSynthesis(heldAfter)) {
    nextRunUnlocks.push(`あと 1 つで「${getKnowledge(hint.id).title}」が繋がります`);
  }
  if (nextRunUnlocks.length === 0) nextRunUnlocks.push("まだ世界は同じ形をしている。もう一度、別の道を試せます。");

  const relationships = newK
    .flatMap((k) => getKnowledge(k.id).relatedNPCs)
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((n) => `${NPC_BY_ID.get(n)?.jp ?? n} について何かが分かった`);

  const available = availableRewrites(meta, { ...run, worldDeltas: [] } as RunState);
  const rewriteButtonLabel = available.length > 0
    ? `▶ REWRITE — ${available[0]!.title}`
    : "▶ REWRITE — 時間を巻き戻す";

  let epitaph: string;
  if (run.outcome === "cleared") {
    epitaph = "あなたは今回の終わりまで辿り着いた。世界はまだ、同じ場所を回っている。";
  } else if (run.deathCause?.includes("灰の扉")) {
    epitaph = "あなたは知るために死んだ。それは無駄ではない。";
  } else if (run.deathCause?.includes("敗れた")) {
    epitaph = `あなたは${run.deathCause.replace(" に敗れた", "")}の戦い方を見た。次は、それを知っている。`;
  } else {
    epitaph = "失われたのは、失ってもいいものだけだ。";
  }

  return {
    runNumber: run.runNumber,
    outcome: run.outcome === "cleared" ? "cleared" : "dead",
    deathCause: run.deathCause,
    epitaph,
    newKnowledge: newK,
    firstSeen: run.firstSeenThisRun,
    bossesDefeated: run.outcome === "cleared" ? [getBoss(run.map.bossId).jp] : [],
    relationshipsLearned: relationships,
    historyRewritten: run.worldDeltas.map((d) => d.summary),
    bestSynergy: run.activeSynergies.length > 0
      ? SYNERGIES.find((s) => s.id === run.activeSynergies[run.activeSynergies.length - 1])?.jp ?? null
      : null,
    nextRunUnlocks: nextRunUnlocks.slice(0, 6),
    rewriteButtonLabel,
    endingReached: run.outcome === "cleared" ? meta.unlockedEndings[meta.unlockedEndings.length - 1] : undefined,
  };
}

export { WORLD_TRUTHS };
