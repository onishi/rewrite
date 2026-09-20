import type {
  MetaState, RunState, PlayerState, RewardOffer, Scene, SceneChoice,
  RunReport, RewriteDef, KnowledgeId, EndingId, LogEntry, WorldDelta,
} from "../types.js";
import type { Floor, DungeonEntity } from "../dungeon/types.js";
import { Rng } from "../rng.js";
import { SKILLS, getSkill, activeSynergies, synergyHintFor, SYNERGIES } from "../content/skills.js";
import { ITEMS, getItem, NPC_BY_ID, ENDINGS, WORLD_TRUTHS } from "../content/world.js";
import { REWRITES, REWRITE_BY_ID, getBoss } from "../content/enemies.js";
import { getKnowledge, KNOWLEDGE, nearSynthesis } from "../content/knowledge.js";
import {
  grantKnowledge, knows, invalidate, rollStructural, applyDistortionDecay,
  runSynthesis, reliabilityOf, type Acquisition,
} from "./knowledge.js";
import { generateFloor, revealRoom } from "../dungeon/generate.js";
import {
  computeVisibility, lightRadiusFor, stepPlayer, monsterTurn, findPath,
  type MoveOutcome,
} from "../dungeon/runtime.js";
import { DUNGEON_DEPTH, stratumFor, entityAt, idx } from "../dungeon/types.js";
import {
  startCombat, playerAction, combatRewards,
  type CombatContext, type PlayerAction, type ActionResult,
} from "./combat.js";

export const RUN_START_CLOCK = 6 * 60;
export const RUN_DEADLINE = 24 * 60;
/** Every step underground costs time.  The clock is the exploration budget. */
export const STEP_MINUTES = 1;
export const DESCEND_MINUTES = 10;
export const VILLAGE_ACTION_BUDGET = 3;

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

function rngFor(run: RunState, tag: string): Rng {
  return new Rng(`${run.seed}:${tag}:${run.depth}:${run.clock}:${run.floorSteps}`);
}

function ctxFor(meta: MetaState, run: RunState, tag: string): CombatContext {
  return { meta, run, rng: rngFor(run, tag) };
}

function lightRadius(run: RunState): number {
  return lightRadiusFor(run.player.items.includes("I_TORCH"), run.player.skills.includes("S07"));
}

/** Everything the rest of the engine needs to know about "where you are". */
export function currentPlace(run: RunState): { name: string; region: string; depth: number; npcId?: string } {
  const s = stratumFor(run.depth);
  const npc = run.floor.entities.find(
    (e) => e.kind === "npc" && Math.abs(e.x - run.px) <= 1 && Math.abs(e.y - run.py) <= 1,
  );
  return { name: `B${run.depth}F ${s.title}`, region: s.region, depth: run.depth, npcId: npc?.npcId };
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
    floor: null as unknown as Floor,
    depth: 1, px: 0, py: 0, bossId,
    floorsVisited: [], floorSteps: 0,
    npcTrust: {}, npcFlags: {}, deadNpcs: [], suspicion: 0,
    activeSynergies: activeSynergies(starters).map((s) => s.id),
    worldDeltas: [], knowledgeGainedThisRun: [], synthesizedThisRun: [], firstSeenThisRun: [],
    combat: null, pendingReward: null, pendingScene: null,
    log: [], outcome: "running",
    regionDanger: {}, freeActionsLeft: 3, routeUnlocks: [],
  };

  run.floor = buildFloor(meta, run, 1, liveKnowledge);
  placeOnEntry(run);

  if (player.skills.includes("S20")) {
    const shaky = Object.values(meta.knowledge).find((k) => k.reliability === "uncertain");
    if (shaky) { shaky.reliability = "confirmed"; log(run, `記録の環: ${getKnowledge(shaky.id).title} が Confirmed になった`, "knowledge"); }
  }

  log(run, `RUN ${run.runNumber} — 村アシュメア、井戸の前`, "info");
  run.pendingScene = villageScene(meta, run);
  return run;
}

function buildFloor(meta: MetaState, run: RunState, depth: number, live: Set<KnowledgeId>): Floor {
  const floor = generateFloor({
    depth,
    rng: new Rng(`${run.seed}:floor:${depth}:${run.worldDeltas.length}`),
    meta,
    liveKnowledge: live,
    takenThisRun: new Set(run.knowledgeGainedThisRun),
    bossId: run.bossId,
    regionDanger: run.regionDanger,
  });
  const s = stratumFor(depth);
  if (!run.floorsVisited.includes(`B${depth}F ${s.title}`)) {
    run.floorsVisited.push(`B${depth}F ${s.title}`);
  }
  if (!meta.firstSeenLocations.includes(s.region)) {
    meta.firstSeenLocations.push(s.region);
    run.firstSeenThisRun.push(`B${depth}F ${s.title}`);
  }
  return floor;
}

function placeOnEntry(run: RunState): void {
  run.px = run.floor.entry.x;
  run.py = run.floor.entry.y;
  run.floorSteps = 0;
  computeVisibility(run.floor, run.px, run.py, lightRadius(run));
}

function liveKnowledgeFor(meta: MetaState, run: RunState): Set<KnowledgeId> {
  return rollStructural(meta, new Rng(`${run.seed}:structural:${run.depth}`));
}

// ------------------------------------------------------------------- surface
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
  choices.push({ actionId: "VILLAGE_LEAVE", label: "▼ 井戸を降りる" });
  for (const rw of availableRewrites(meta, run)) {
    choices.unshift({ actionId: `REWRITE:${rw.id}`, label: `▶ REWRITE — ${rw.title}` });
  }
  return {
    nodeId: "SURFACE",
    title: "村アシュメア — 灰の迷宮 入口",
    narrative: run.runNumber === 1
      ? "井戸の底から風が上がってくる。誰かが掘ったにしては、深すぎる。"
      : `${run.runNumber} 度目の朝。同じ井戸、同じ風。違うのは、あなたが知っていることだけだ。`,
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

export function applyRewrite(meta: MetaState, run: RunState, rewriteId: string): {
  delta: WorldDelta; invalidated: KnowledgeId[]; lines: string[];
} {
  const rw = REWRITE_BY_ID.get(rewriteId);
  if (!rw) throw new Error(`unknown rewrite ${rewriteId}`);
  const lines: string[] = [];
  const invalidated: KnowledgeId[] = [];
  let reshape = false;

  const cost = run.player.skills.includes("S20") ? Math.max(0, rw.timeCost - 60) : rw.timeCost;
  spendTime(meta, run, cost, lines);

  for (const eff of rw.effects) {
    switch (eff.kind) {
      case "cancelScheduledEvent":
        lines.push("予定されていた出来事が消滅した"); reshape = true; break;
      case "npcFlag":
        (run.npcFlags[eff.npc] ??= []).push(eff.flag); break;
      case "injectNode":
        reshape = true;
        run.npcFlags["__inject"] = [...(run.npcFlags["__inject"] ?? []), eff.nodeId];
        lines.push("本来存在しなかった出来事が、下の階で起きようとしている"); break;
      case "removeNode":
        run.npcFlags["__remove"] = [...(run.npcFlags["__remove"] ?? []), eff.nodeId];
        reshape = true; break;
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
        if (meta.distortion >= 3 && !meta.knowledge["K019"]) grantKnowledge(meta, run, "K019");
        break;
      case "swapBoss":
        run.bossId = eff.to;
        lines.push(`最下層で待つ者が変わった: ${getBoss(eff.to).jp}`); break;
      case "dangerShift":
        run.regionDanger[eff.region] = (run.regionDanger[eff.region] ?? 0) + eff.delta;
        lines.push(`${eff.region} の危険度 ${eff.delta > 0 ? "+" : ""}${eff.delta}`);
        reshape = true; break;
      case "grantItem":
        run.player.items.push(eff.item); lines.push(`${getItem(eff.item).jp} を手に入れた`); break;
      case "unlockRoute":
        run.routeUnlocks.push(eff.routeId); lines.push(`新しいルートが開いた: ${eff.routeId}`); break;
      case "allyNextFight":
        run.player.flags["ally"] = 1; lines.push("次の戦闘に味方が加わる"); break;
      case "killNpc":
        run.deadNpcs.push(eff.npc);
        for (const e of run.floor.entities) {
          if (e.kind === "npc" && e.npcId === eff.npc) e.used = true;
        }
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

  // Changing history re-shapes the floors you have not reached yet.
  if (reshape) {
    run.player.flags["reshaped"] = 1;
    lines.push("この先の階層の形が変わった。");
  }
  return { delta, invalidated, lines };
}

// ------------------------------------------------------------------- movement
export interface StepResult {
  lines: string[];
  acquisitions: Acquisition[];
  combatStarted?: boolean;
  sceneOpened?: boolean;
  descended?: boolean;
  blocked?: boolean;
}

/** One step in a compass direction.  Bumping into something is how you use it. */
export function move(meta: MetaState, run: RunState, dx: number, dy: number): StepResult {
  const out: StepResult = { lines: [], acquisitions: [] };
  if (run.outcome !== "running" || run.combat || run.pendingScene || run.pendingReward) {
    out.blocked = true;
    return out;
  }

  const res = stepPlayer(run.floor, run.px, run.py, dx, dy);
  const o: MoveOutcome = res.outcome;

  if (o.kind === "blocked") { out.blocked = true; return out; }

  if (o.kind === "encounter") {
    run.px = res.x; run.py = res.y;
    startEncounter(meta, run, o.entity, true, out);
    return out;
  }
  if (o.kind === "npc") {
    // Someone you are done with must not be able to wall off a corridor:
    // walk through them instead.
    if (o.entity.used || run.deadNpcs.includes(o.entity.npcId ?? "")) {
      const tx = run.px + dx, ty = run.py + dy;
      o.entity.x = run.px; o.entity.y = run.py;
      run.px = tx; run.py = ty;
      out.lines.push(`${o.entity.name}とすれ違った。`);
      run.floorSteps += 1;
      advanceClock(meta, run, STEP_MINUTES, out);
      if (run.outcome !== "running") return out;
      computeVisibility(run.floor, run.px, run.py, lightRadius(run));
      const mt2 = monsterTurn(run.floor, run.px, run.py, rngFor(run, "monsters"));
      out.lines.push(...mt2.lines);
      if (mt2.ambushedBy) startEncounter(meta, run, mt2.ambushedBy, false, out);
      return out;
    }
    openNpcScene(meta, run, o.entity, out);
    return out;
  }

  run.px = res.x; run.py = res.y;
  run.floorSteps += 1;
  advanceClock(meta, run, STEP_MINUTES, out);
  if (run.outcome !== "running") return out;

  if (o.kind === "item") {
    run.player.items.push(o.entity.itemId!);
    applyRelic(run, o.entity.itemId!);
    run.floor.entities = run.floor.entities.filter((e) => e.uid !== o.entity.uid);
    out.lines.push(`${getItem(o.entity.itemId!).jp} を拾った`);
    log(run, out.lines[out.lines.length - 1]!, "reward");
  }
  if (o.kind === "feature") {
    openFeatureScene(meta, run, o.entity, out);
    if (out.sceneOpened) { computeVisibility(run.floor, run.px, run.py, lightRadius(run)); return out; }
  }

  computeVisibility(run.floor, run.px, run.py, lightRadius(run));
  const mt = monsterTurn(run.floor, run.px, run.py, rngFor(run, "monsters"));
  out.lines.push(...mt.lines);
  if (mt.ambushedBy) startEncounter(meta, run, mt.ambushedBy, false, out);
  return out;
}

/** Walk toward a tile, stopping the moment anything interesting happens. */
export function travelTo(meta: MetaState, run: RunState, tx: number, ty: number, maxSteps = 60): StepResult {
  const merged: StepResult = { lines: [], acquisitions: [] };
  for (let i = 0; i < maxSteps; i++) {
    if (run.outcome !== "running" || run.combat || run.pendingScene || run.pendingReward) break;
    if (run.px === tx && run.py === ty) break;
    // Prefer a route around monsters, but a sleeping body in a one-tile
    // corridor is a door, not a wall: fall back to a path that goes through it
    // so the player can walk up and engage.
    const path = findPath(run.floor, { x: run.px, y: run.py }, { x: tx, y: ty }, {
      blockedBy: (e) => e.kind === "enemy",
    }) ?? findPath(run.floor, { x: run.px, y: run.py }, { x: tx, y: ty });
    const next = path?.[0];
    if (!next) break;
    // Stop rather than stroll into a NEW monster's reach: whether to engage is
    // the player's call.  Something already breathing down your neck is not a
    // reason to refuse to move — walking away from it is a legitimate choice.
    const targetTile = next.x === tx && next.y === ty;
    const newThreat = run.floor.entities.some((e) => {
      if (e.kind !== "enemy" || !e.awake) return false;
      const nearNext = Math.max(Math.abs(e.x - next.x), Math.abs(e.y - next.y)) <= 1;
      const nearNow = Math.max(Math.abs(e.x - run.px), Math.abs(e.y - run.py)) <= 1;
      return nearNext && !nearNow;
    });
    // Only halt a journey already in progress.  Refusing the very first step
    // would deadlock travel whenever a monster stands between you and the goal.
    if (!targetTile && newThreat && i > 0) break;
    const r = move(meta, run, next.x - run.px, next.y - run.py);
    merged.lines.push(...r.lines);
    merged.acquisitions.push(...r.acquisitions);
    merged.combatStarted ||= r.combatStarted;
    merged.sceneOpened ||= r.sceneOpened;
    merged.descended ||= r.descended;
    if (r.blocked || r.combatStarted || r.sceneOpened) break;
    // stop next to an awake monster rather than walking past it
    if (run.floor.entities.some((e) => e.kind === "enemy" && e.awake
      && Math.max(Math.abs(e.x - run.px), Math.abs(e.y - run.py)) <= 1)) break;
  }
  return merged;
}

/** Re-open whatever you are standing on.  Walking onto a tile opens it once;
 *  this is how you get back to it without stepping off and back on. */
export function interactHere(meta: MetaState, run: RunState): StepResult {
  const out: StepResult = { lines: [], acquisitions: [] };
  if (run.outcome !== "running" || run.combat || run.pendingScene || run.pendingReward) {
    out.blocked = true;
    return out;
  }
  const e = entityAt(run.floor, run.px, run.py);
  if (!e) { out.blocked = true; out.lines.push("ここには何もない。"); return out; }
  if (e.kind === "feature") openFeatureScene(meta, run, e, out);
  else if (e.kind === "npc") openNpcScene(meta, run, e, out);
  else out.blocked = true;
  return out;
}

/** Standing still costs the same as a step; useful for letting a monster come to you. */
export function wait(meta: MetaState, run: RunState): StepResult {
  const out: StepResult = { lines: [], acquisitions: [] };
  if (run.outcome !== "running" || run.combat || run.pendingScene) { out.blocked = true; return out; }
  run.floorSteps += 1;
  advanceClock(meta, run, STEP_MINUTES, out);
  if (run.outcome !== "running") return out;
  computeVisibility(run.floor, run.px, run.py, lightRadius(run));
  const mt = monsterTurn(run.floor, run.px, run.py, rngFor(run, "wait"));
  out.lines.push(...mt.lines);
  if (mt.ambushedBy) startEncounter(meta, run, mt.ambushedBy, false, out);
  return out;
}

/**
 * The clock is the real hit-point bar of a run.  Past midnight the ash starts
 * falling and it does not care about Guard — you are meant to be on your way
 * down, not sweeping every room.
 */
export function spendTime(meta: MetaState, run: RunState, minutes: number, lines: string[]): void {
  run.clock += minutes;
  if (run.clock <= RUN_DEADLINE) return;

  const over = run.clock - RUN_DEADLINE;
  if (run.player.flags["ashWarned"] !== 1) {
    run.player.flags["ashWarned"] = 1;
    lines.push("日付が変わった。天井から灰が落ちはじめる。");
    log(run, "灰が降りはじめた", "danger");
  }
  const tick = Math.max(1, Math.ceil(minutes / 2)) * (1 + Math.floor(over / 60));
  run.player.hp -= tick;
  lines.push(`灰が肌を焼く（${tick}）`);
  if (run.player.hp <= 0) run.player.hp = 0;
}

function advanceClock(meta: MetaState, run: RunState, minutes: number, out: StepResult): void {
  run.clock += minutes;
  if (run.clock <= RUN_DEADLINE) return;

  const over = run.clock - RUN_DEADLINE;
  if (run.player.flags["ashWarned"] !== 1) {
    run.player.flags["ashWarned"] = 1;
    out.lines.push("日付が変わった。天井から灰が落ちはじめる。");
    log(run, "灰が降りはじめた", "danger");
  }
  const tick = 1 + Math.floor(over / 30);
  run.player.hp -= tick;
  out.lines.push(`灰が肌を焼く（${tick}）`);
  if (run.player.hp <= 0) {
    run.player.hp = 0;
    out.acquisitions.push(...onDeath(meta, run, "灰に呑まれた"));
  }
}

export function descend(meta: MetaState, run: RunState, skip = 1): StepResult {
  const out: StepResult = { lines: [], acquisitions: [] };
  run.pendingScene = null;
  const next = Math.min(DUNGEON_DEPTH, run.depth + skip);
  run.depth = next;
  spendTime(meta, run, DESCEND_MINUTES, out.lines);
  run.floor = buildFloor(meta, run, next, liveKnowledgeFor(meta, run));
  placeOnEntry(run);
  out.descended = true;
  out.lines.push(`B${next}F ${stratumFor(next).title} へ降りた`);
  log(run, out.lines[out.lines.length - 1]!, "info");
  if (next >= DUNGEON_DEPTH) {
    out.lines.push(`この階の奥に ${getBoss(run.bossId).jp} がいる。`);
    log(run, `BOSS FLOOR: ${getBoss(run.bossId).jp}`, "danger");
  }
  return out;
}

// ------------------------------------------------------------------- encounters
function startEncounter(
  meta: MetaState, run: RunState, entity: DungeonEntity, byPlayer: boolean, out: StepResult,
): void {
  const ctx = ctxFor(meta, run, "combat");
  if (entity.bossId) {
    if (run.deadNpcs.includes(getBoss(entity.bossId).npcId)) {
      out.lines.push(`${getBoss(entity.bossId).jp} はもういない。対決は起きなかった。`);
      run.outcome = "cleared";
      resolveEnding(meta, run);
      return;
    }
    run.combat = startCombat(ctx, { bossId: entity.bossId });
    log(run, `BOSS: ${getBoss(entity.bossId).jp}`, "danger");
  } else {
    run.combat = startCombat(ctx, { enemyIds: entity.pack ?? ["E_DOG"] });
    if (!byPlayer) {
      run.combat.firstStrikeUsed = true;
      out.lines.push("不意を突かれた。先手は取れない。");
    }
  }
  run.player.flags["engagedUid"] = 0;
  run.npcFlags["__engaged"] = [entity.uid];
  out.combatStarted = true;
}

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
    const acq = onDeath(meta, run, c.isBoss ? `${getBoss(c.bossId!).jp} に敗れた` : "戦闘で倒れた", c.bossId);
    return { ...res, resolved: true, acquisitions: acq };
  }
  return res;
}

function finishCombat(meta: MetaState, run: RunState, fled: boolean): { reward?: RewardOffer; acquisitions?: Acquisition[] } {
  const c = run.combat!;
  const wasBoss = c.isBoss;
  const ctx = ctxFor(meta, run, "loot");
  const acquisitions: Acquisition[] = [];
  const engagedUid = run.npcFlags["__engaged"]?.[0];

  if (!fled) {
    const { gold, xp } = combatRewards(ctx, c);
    run.player.gold += gold;
    gainXp(run, xp);
    log(run, `勝利 — Gold +${gold} / XP +${xp}`, "reward");
    if (engagedUid) run.floor.entities = run.floor.entities.filter((e) => e.uid !== engagedUid);
  } else {
    spendTime(meta, run, 20, []);
    // slipping away leaves the monster where it was, but awake
    const e = run.floor.entities.find((x) => x.uid === engagedUid);
    if (e) e.awake = true;
    log(run, "戦闘を離脱した", "info");
  }
  run.player.flags["ally"] = 0;
  run.combat = null;
  run.npcFlags["__engaged"] = [];

  if (wasBoss) {
    run.outcome = "cleared";
    const ending = resolveEnding(meta, run);
    if (ending) log(run, `ENDING: ${ENDINGS.find((e) => e.id === ending)?.name}`, "info");
    return { acquisitions };
  }
  if (fled) return { acquisitions };

  // Builds stay legible only if skills are scarce.  Elites always pay out;
  // ordinary monsters mostly pay in gold and experience.
  const wasElite = (c.enemies[0]?.maxHp ?? 0) >= 60;
  const rng = rngFor(run, "rewardRoll");
  computeVisibility(run.floor, run.px, run.py, lightRadius(run));
  if (!wasElite && !rng.chance(0.3)) return { acquisitions };

  const reward = offerSkillReward(meta, run, wasElite ? "rare" : "normal");
  run.pendingReward = reward;
  return { reward, acquisitions };
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
  const rng = rngFor(run, `reward${run.player.xp}`);
  const owned = new Set(run.player.skills);
  const pool = SKILLS.filter((s) => !owned.has(s.id) && (tier === "explore" ? s.pool !== "combat" : s.pool !== "explore"));
  const picks = rng.sample(pool.map((s) => s.id), 3);

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
    const hint = synergyHintFor(id, run.player.skills);
    if (hint) synergyHints[i] = hint;
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
    const formed = activeSynergies(run.player.skills).map((s) => s.id);
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
    applyRelic(run, choice);
    lines.push(`${getItem(choice).jp} を手に入れた`);
  }
  for (const l of lines) log(run, l, "reward");
  return lines;
}

// ------------------------------------------------------------------- scenes
function openFeatureScene(meta: MetaState, run: RunState, e: DungeonEntity, out: StepResult): void {
  const hasPremonition = run.player.skills.includes("S03");
  const choices: SceneChoice[] = [];
  let title = e.name;
  let narrative = "";

  switch (e.feature) {
    case "stairsDown": {
      const skip = e.name.includes("スキップ") ? 2 : 1;
      title = skip > 1 ? "井戸の抜け道" : "下り階段";
      narrative = skip > 1
        ? "格子の向こうは井戸の底だ。ここを抜ければ一階層を飛ばせる。"
        : "下へ続く階段。まだこの階で見ていない場所があるかもしれない。";
      choices.push({ actionId: `DESCEND:${skip}`, label: skip > 1 ? "▼ 抜け道を使う（1階層スキップ）" : "▼ 降りる" });
      choices.push({ actionId: "LEAVE", label: "まだ降りない" });
      break;
    }
    case "chest":
      narrative = "埃をかぶった箱。鍵はかかっていない。";
      choices.push({ actionId: `CHEST:${e.uid}`, label: "開ける" });
      choices.push({ actionId: "LEAVE", label: "触らない" });
      break;
    case "lore":
      narrative = "誰かが残した痕跡。読み解く時間はある。";
      choices.push({ actionId: `LORE:${e.uid}`, label: "調べる（Knowledge）", dangerHint: hasPremonition ? "safe" : undefined });
      choices.push({ actionId: "LEAVE", label: "素通りする" });
      break;
    case "ashdoor": {
      const cost = Math.floor(run.player.hp * 0.25);
      narrative = "扉の隙間から灰がこぼれている。中に何かがあるのは間違いない。";
      choices.push({
        actionId: `ASH:${e.uid}`, label: `扉を開ける（HP −${cost}）`,
        dangerHint: hasPremonition ? (run.player.hp - cost <= 10 ? "lethal" : "risky") : undefined,
      });
      if (run.player.skills.includes("S05")) {
        choices.push({ actionId: `ASHBLOOD:${e.uid}`, label: "血の代償で開ける（HP −12・確実）" });
      }
      choices.push({ actionId: "LEAVE", label: "引き返す" });
      break;
    }
    case "altar":
      narrative = "古い祭壇。捧げるものを求めている。";
      choices.push({ actionId: `SHRINE_HP:${e.uid}`, label: "HP を 25% 捧げる（レア Skill 3択）", dangerHint: hasPremonition ? "risky" : undefined });
      choices.push({ actionId: `SHRINE_GOLD:${e.uid}`, label: "Gold 50 を捧げる（Item）", locked: run.player.gold < 50, lockReason: "Gold が足りない" });
      choices.push({ actionId: "LEAVE", label: "何も捧げない" });
      break;
    case "campfire":
      narrative = "誰かが焚いた火がまだ残っている。";
      choices.push({ actionId: `REST_HEAL:${e.uid}`, label: `休む（HP +${Math.floor(run.player.maxHp * 0.4)} / 30分）` });
      choices.push({ actionId: `REST_TRAIN:${e.uid}`, label: "鍛える（最大 HP +6 / 攻撃力 +2 / 30分）" });
      choices.push({ actionId: "LEAVE", label: "先へ進む" });
      break;
    case "shop": {
      narrative = "こんなところに商人がいる。";
      const rng = rngFor(run, `shop${e.uid}`);
      const stock = rng.sample(ITEMS.filter((i) => i.price > 0).map((i) => i.id), 4);
      for (const id of stock) {
        const item = getItem(id);
        const price = run.player.skills.includes("S04") ? Math.floor(item.price * 0.8) : item.price;
        choices.push({
          actionId: `BUY:${id}:${price}`, label: `${item.jp} — ${price}G（${item.desc}）`,
          locked: run.player.gold < price, lockReason: "Gold が足りない",
        });
      }
      choices.push({
        actionId: "BUY_TIP:60",
        label: "求めるスキルの噂を買う — 60G（次の3択にシナジー枠が確定で混ざる）",
        locked: run.player.gold < 60, lockReason: "Gold が足りない",
      });
      if (run.player.skills.includes("S10")) choices.push({ actionId: `SHOP_STEAL:${e.uid}`, label: "盗む（Suspicion +2 のリスク）" });
      choices.push({ actionId: "LEAVE", label: "立ち去る" });
      break;
    }
    default:
      return;
  }

  run.pendingScene = {
    nodeId: e.uid, title, narrative, choices,
    allowFreeAction: e.feature !== "shop",
  };
  out.sceneOpened = true;
}

function openNpcScene(meta: MetaState, run: RunState, e: DungeonEntity, out: StepResult): void {
  const npcId = e.npcId ?? "N01";
  const npc = NPC_BY_ID.get(npcId)!;
  const choices: SceneChoice[] = [];
  const dead = run.deadNpcs.includes(npcId) || e.used;

  if (!dead) {
    if (!e.used) choices.push({ actionId: `TALK:${e.uid}`, label: "話を聞く" });
    else choices.push({ actionId: "LEAVE_SPENT", label: "（もう話すことはなさそうだ）" });
    if (run.player.skills.includes("S01") && npc.lies.length > 0) {
      choices.push({ actionId: `LIE_EYE:${e.uid}`, label: "［嘘看破］「それは嘘だ」", requiresSkill: "S01" });
    }
    if (run.player.skills.includes("S13")) {
      choices.push({ actionId: `EMPATH:${e.uid}`, label: "［共感］本当の目的を読む", requiresSkill: "S13" });
    }
    if (run.player.skills.includes("S02")) {
      choices.push({ actionId: `NECRO:${e.uid}`, label: "［死霊術］近くの死者に聞く", requiresSkill: "S02" });
    }
    if (npcId === "N03" && knows(meta, "K014")) {
      choices.push({ actionId: `PRESS_PRIEST:${e.uid}`, label: "［K014］入れ替わりについて問い詰める", requiresKnowledge: "K014" });
    }
    for (const rw of availableRewrites(meta, run)) {
      if (rw.targetNpc !== npcId) continue;
      choices.push({ actionId: `REWRITE:${rw.id}`, label: `▶ REWRITE — ${rw.title}` });
    }
  }
  choices.push({ actionId: `PASS:${e.uid}`, label: "すれ違って先へ進む" });
  choices.push({ actionId: "LEAVE", label: "立ち去る" });

  run.pendingScene = {
    nodeId: e.uid,
    title: `${currentPlace(run).name} — ${npc.jp}`,
    narrative: dead ? `${npc.jp} の姿はない。` : `${npc.jp} がこちらを見た。`,
    speaker: npcId,
    dialogue: dead ? undefined : dejaVuLine(meta, npcId),
    choices,
    allowFreeAction: true,
  };
  out.sceneOpened = true;
}

export interface ChoiceResult {
  lines: string[];
  acquisitions: Acquisition[];
  reward?: RewardOffer;
  sceneClosed: boolean;
  combatStarted?: boolean;
  descended?: boolean;
  rewriteApplied?: string;
}

export function resolveChoice(meta: MetaState, run: RunState, actionId: string): ChoiceResult {
  const lines: string[] = [];
  const acquisitions: Acquisition[] = [];
  const rng = rngFor(run, `choice:${actionId}`);
  const [verb, arg, arg2] = actionId.split(":");
  const spend = (m: number): void => spendTime(meta, run, m, lines);
  const entity = arg ? run.floor.entities.find((e) => e.uid === arg) : undefined;
  let sceneClosed = true;
  let reward: RewardOffer | undefined;
  let rewriteApplied: string | undefined;
  let descended = false;

  const consume = (): void => {
    if (!entity) return;
    run.floor.entities = run.floor.entities.filter((e) => e.uid !== entity.uid);
  };

  if (verb === "REWRITE") {
    const res = applyRewrite(meta, run, arg!);
    lines.push(`REWRITE — ${REWRITE_BY_ID.get(arg!)!.utterance}`, ...res.lines);
    rewriteApplied = arg;
    if (run.pendingScene) {
      run.pendingScene.choices = run.pendingScene.choices.filter((c) => c.actionId !== actionId);
    }
    return { lines, acquisitions, sceneClosed: false, rewriteApplied };
  }
  if (verb === "BUY") {
    const price = Number(arg2);
    if (run.player.gold >= price) {
      run.player.gold -= price;
      run.player.items.push(arg!);
      applyRelic(run, arg!);
      lines.push(`${getItem(arg!).jp} を買った（−${price}G）`);
    } else lines.push("Gold が足りない");
    if (run.pendingScene) run.pendingScene.choices = run.pendingScene.choices.filter((c) => c.actionId !== actionId);
    return { lines, acquisitions, sceneClosed: false };
  }
  if (verb === "BUY_TIP") {
    const price = Number(arg);
    if (run.player.gold >= price) {
      run.player.gold -= price;
      run.player.flags["synergyTip"] = 1;
      lines.push("「その組み合わせを探しているなら、次の戦いのあとに見つかるはずだ」");
    } else lines.push("Gold が足りない");
    return { lines, acquisitions, sceneClosed: false };
  }
  if (verb === "DESCEND") {
    const r = descend(meta, run, Number(arg) || 1);
    lines.push(...r.lines);
    return { lines, acquisitions, sceneClosed: true, descended: true };
  }

  switch (verb) {
    case "VILLAGE_REST":
      run.player.flags["villageActions"] = (run.player.flags["villageActions"] ?? 0) + 1;
      spend(60); run.player.hp = Math.min(run.player.maxHp, run.player.hp + 20);
      lines.push("少し休んだ（HP +20）"); sceneClosed = false; break;
    case "VILLAGE_ASK": {
      run.player.flags["villageActions"] = (run.player.flags["villageActions"] ?? 0) + 1;
      spend(60);
      const hint = nearSynthesis(new Set(Object.keys(meta.knowledge)));
      if (hint.length > 0) {
        lines.push(`「${getKnowledge(hint[0]!.missing[0]!).title.slice(0, 10)}……そんな話を聞いたことがある」`);
        lines.push(`（${getKnowledge(hint[0]!.id).title} まであと 1 つ）`);
      } else lines.push("「今日は静かなものだ」");
      sceneClosed = false; break;
    }
    case "VILLAGE_SHOP": {
      run.player.flags["villageActions"] = (run.player.flags["villageActions"] ?? 0) + 1;
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
      lines.push("井戸を降りた。"); break;

    case "LORE": {
      if (entity?.knowledgeId) {
        acquisitions.push(...grantKnowledge(meta, run, entity.knowledgeId));
        const chronicled = run.player.flags["chronicled"] ?? 0;
        if (run.player.skills.includes("S09") && chronicled < 3) {
          run.player.flags["chronicled"] = chronicled + 1;
          const extra = KNOWLEDGE.find((k) => !meta.knowledge[k.id] && !k.synthesizedFrom);
          if (extra) { acquisitions.push(...grantKnowledge(meta, run, extra.id, { reliability: "rumor" })); lines.push("記録者: もう1つ書き留めた"); }
        }
      } else {
        const g = rng.int(20, 45); run.player.gold += g; lines.push(`めぼしいものはなかった（Gold +${g}）`);
      }
      if (!run.player.skills.includes("S09")) spend(20);
      consume();
      break;
    }
    case "CHEST": {
      const item = rng.pick(ITEMS.filter((i) => i.price > 0));
      run.player.items.push(item.id); applyRelic(run, item.id);
      lines.push(`${item.jp} が入っていた`);
      const g = rng.int(15, 40); run.player.gold += g; lines.push(`Gold +${g}`);
      spend(10);
      consume();
      break;
    }
    case "ASH":
    case "ASHBLOOD": {
      const cost = verb === "ASHBLOOD" ? 12 : Math.floor(run.player.hp * 0.25);
      run.player.hp = Math.max(1, run.player.hp - cost);
      lines.push(`灰の扉をくぐった（HP −${cost}）`);
      spend(20);
      if (entity?.knowledgeId) {
        acquisitions.push(...grantKnowledge(meta, run, entity.knowledgeId));
      } else if (run.player.flags["ashSecret"] !== 1) {
        // Exactly one forbidden secret per run.  The ash door is the gamble
        // that buys a truth living eight floors down — not a vending machine.
        run.player.flags["ashSecret"] = 1;
        const deep = KNOWLEDGE.filter(
          (k) => !meta.knowledge[k.id] && !k.synthesizedFrom
            && (k.tags.includes("truth") || k.tags.includes("lore")),
        );
        const any = KNOWLEDGE.filter((k) => !meta.knowledge[k.id] && !k.synthesizedFrom);
        const pool = deep.length > 0 ? deep : any;
        if (pool.length > 0) acquisitions.push(...grantKnowledge(meta, run, rng.pick(pool).id));
      } else {
        const g = rng.int(40, 80);
        run.player.gold += g;
        lines.push(`扉の奥は空だった（Gold +${g}）`);
      }
      const item = rng.pick(ITEMS.filter((i) => i.rarity !== "common"));
      run.player.items.push(item.id); applyRelic(run, item.id);
      lines.push(`${item.jp} を見つけた`);
      consume();
      if (run.player.hp <= 1 && rng.chance(0.3)) {
        acquisitions.push(...onDeath(meta, run, "灰の扉の向こうで力尽きた"));
        lines.push("……ここまでだった。");
      }
      break;
    }
    case "SHRINE_HP": {
      const cost = Math.floor(run.player.hp * 0.25);
      run.player.hp = Math.max(1, run.player.hp - cost);
      lines.push(`血を捧げた（HP −${cost}）`);
      reward = offerSkillReward(meta, run, "rare"); run.pendingReward = reward;
      consume();
      break;
    }
    case "SHRINE_GOLD": {
      run.player.gold -= 50;
      const item = rng.pick(ITEMS.filter((i) => i.rarity !== "common"));
      run.player.items.push(item.id); applyRelic(run, item.id);
      lines.push(`${item.jp} が現れた`);
      consume();
      break;
    }
    case "REST_HEAL":
      run.player.hp = Math.min(run.player.maxHp, run.player.hp + Math.floor(run.player.maxHp * 0.4));
      spend(30);
      lines.push("火の前で休んだ");
      consume();
      break;
    case "REST_TRAIN":
      run.player.maxHp += 6; run.player.hp += 6; run.player.power += 2;
      spend(30);
      lines.push("型を確かめた（最大 HP +6 / 攻撃力 +2）");
      consume();
      break;
    case "SHOP_STEAL": {
      if (rng.chance(0.6)) {
        const item = rng.pick(ITEMS.filter((i) => i.price > 0));
        run.player.items.push(item.id); applyRelic(run, item.id);
        lines.push(`${item.jp} を盗んだ`);
      } else { run.suspicion += 2; lines.push("見られた（Suspicion +2）"); }
      sceneClosed = false; break;
    }
    case "TALK": {
      const npcId = entity?.npcId ?? "N01";
      const npc = NPC_BY_ID.get(npcId)!;
      lines.push(`「${npc.publicGoal}。それだけだ」`);
      spend(10);
      if (entity) entity.used = true;
      if (entity?.knowledgeId && rng.chance(run.player.items.includes("I_EAVESDROP") ? 0.9 : 0.6)) {
        acquisitions.push(...grantKnowledge(meta, run, entity.knowledgeId, { reliability: "uncertain" }));
      } else if (entity?.knowledgeId) {
        lines.push("（もう少し踏み込めば何か聞けたかもしれない）");
      }
      break;
    }
    case "LIE_EYE": {
      const npcId = entity?.npcId ?? "N01";
      const npc = NPC_BY_ID.get(npcId)!;
      lines.push(`［嘘看破］「${npc.lies[0] ?? "……"}」— それは嘘だ。`);
      if (entity?.knowledgeId) acquisitions.push(...grantKnowledge(meta, run, entity.knowledgeId, { reliability: "confirmed" }));
      run.npcTrust[npcId] = (run.npcTrust[npcId] ?? 0) - 1;
      break;
    }
    case "EMPATH": {
      const npcId = entity?.npcId ?? "N01";
      const npc = NPC_BY_ID.get(npcId)!;
      lines.push(`［共感］この人物が本当に望んでいるのは —「${npc.trueGoal}」`);
      if (entity?.knowledgeId) acquisitions.push(...grantKnowledge(meta, run, entity.knowledgeId, { reliability: "uncertain" }));
      break;
    }
    case "NECRO": {
      const used = run.player.flags["necroUses"] ?? 0;
      if (used >= 2) {
        lines.push("［死霊術］この階の死者は、もう何も覚えていない。");
        break;
      }
      run.player.flags["necroUses"] = used + 1;
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
    case "PRESS_PRIEST":
      lines.push("「……あの方は、もうおられません」");
      acquisitions.push(...grantKnowledge(meta, run, "K007", { reliability: "confirmed" }));
      run.npcTrust["N03"] = (run.npcTrust["N03"] ?? 0) - 2;
      break;
    case "LEAVE": lines.push("先へ進んだ"); break;
    case "LEAVE_SPENT": lines.push("……"); break;
    case "PASS": {
      if (entity) {
        entity.used = true;
        lines.push(`${entity.name}の横をすり抜けた。`);
      }
      break;
    }
    default: lines.push("……"); break;
  }

  if (run.pendingScene?.nodeId === "SURFACE" && !sceneClosed) {
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

  if (run.player.hp <= 0 && run.outcome === "running") {
    acquisitions.push(...onDeath(meta, run, "灰に呑まれた"));
    sceneClosed = true;
  }
  if (sceneClosed) run.pendingScene = null;
  computeVisibility(run.floor, run.px, run.py, lightRadius(run));
  for (const l of lines) log(run, l, "info");
  for (const a of acquisitions) log(run, `KNOWLEDGE: ${a.def.title}`, "knowledge");
  return { lines, acquisitions, reward, sceneClosed, descended, rewriteApplied };
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
  run.pendingScene = null;
  const acquisitions: Acquisition[] = [];

  if (bossId) {
    const k = getBoss(bossId).consolationKnowledge;
    if (!meta.knowledge[k]) acquisitions.push(...grantKnowledge(meta, run, k));
  }
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
  let ending: EndingId;
  if (run.bossId === "B_WRITER") ending = "E3";
  else if (run.bossId === "B_SELD" && (knows(meta, "K007") || knows(meta, "K022"))) ending = "E2";
  else ending = "E1";
  if (!meta.unlockedEndings.includes(ending)) meta.unlockedEndings.push(ending);
  return ending;
}

/** The tower route overrides the local conspiracy: key plus K018 changes who waits below. */
export function checkTowerRoute(meta: MetaState, run: RunState): boolean {
  if (run.bossId === "B_WRITER") return false;
  if (!run.player.items.includes("I_GRAVEKEY") || !knows(meta, "K018")) return false;
  run.bossId = "B_WRITER";
  for (const e of run.floor.entities) if (e.bossId) e.bossId = "B_WRITER";
  log(run, "灰の鍵が反応している。最下層で待つ者が変わった。", "rewrite");
  return true;
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
      if (e.includes("出現") || e.includes("ショートカット") || e.includes("回避") || e.includes("×2") || e.includes("短縮")) {
        nextRunUnlocks.push(e);
      }
    }
  }
  for (const hint of nearSynthesis(heldAfter)) {
    nextRunUnlocks.push(`あと 1 つで「${getKnowledge(hint.id).title}」が繋がります`);
  }
  if (nextRunUnlocks.length === 0) nextRunUnlocks.push("まだ迷宮は同じ形をしている。もう一度、別の道を試せます。");

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
    epitaph = "あなたは最下層まで辿り着いた。迷宮はまだ、同じ場所を回っている。";
  } else if (run.deathCause?.includes("灰")) {
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
    bossesDefeated: run.outcome === "cleared" ? [getBoss(run.bossId).jp] : [],
    relationshipsLearned: relationships,
    historyRewritten: run.worldDeltas.map((d) => d.summary),
    bestSynergy: run.activeSynergies.length > 0
      ? SYNERGIES.find((s) => s.id === run.activeSynergies[run.activeSynergies.length - 1])?.jp ?? null
      : null,
    nextRunUnlocks: nextRunUnlocks.slice(0, 6),
    rewriteButtonLabel,
    endingReached: run.outcome === "cleared" ? meta.unlockedEndings[meta.unlockedEndings.length - 1] : undefined,
    deepestFloor: `B${run.depth}F ${stratumFor(run.depth).title}`,
  };
}

export { WORLD_TRUTHS, DUNGEON_DEPTH };
