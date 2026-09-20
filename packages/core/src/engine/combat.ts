import type {
  CombatState, EnemyState, PlayerState, Intent, Element, Status, StatusKind,
  EnemyMove, SkillEffect, MetaState, RunState, SpecialAction, EnemyDef, BossDef,
} from "../types.js";
import { Rng } from "../rng.js";
import { getSkill, activeSynergies } from "../content/skills.js";
import { getItem } from "../content/world.js";
import { getEnemy, getBoss } from "../content/enemies.js";
import { specialActionsFor, procKnowledge, activeEffects, knows } from "./knowledge.js";

/**
 * Turn-based combat.  Entirely deterministic given (state, rng) — no LLM call
 * exists anywhere in this file, by design (DESIGN §17).
 */

export const CRIT_MULT = 2.0;

export interface CombatContext {
  meta: MetaState;
  run: RunState;
  rng: Rng;
}

function synergyFlags(player: PlayerState): Set<string> {
  const flags = new Set<string>();
  for (const s of activeSynergies(player.skills)) for (const g of s.grants) flags.add(g);
  return flags;
}

function passives(player: PlayerState): Set<string> {
  const p = new Set<string>();
  for (const id of player.skills) for (const t of getSkill(id).passives) p.add(t);
  return p;
}

function statusAmount(s: Status[], kind: StatusKind): number {
  return s.find((x) => x.kind === kind)?.amount ?? 0;
}

function addStatus(list: Status[], kind: StatusKind, amount: number): void {
  if (amount <= 0) return;
  const cur = list.find((x) => x.kind === kind);
  if (cur) cur.amount += amount;
  else list.push({ kind, amount });
}

function decayStatuses(list: Status[], kinds: StatusKind[]): void {
  for (const k of kinds) {
    const s = list.find((x) => x.kind === k);
    if (!s) continue;
    s.amount -= 1;
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.amount <= 0) list.splice(i, 1);
}

// ------------------------------------------------------------------ spawning
export function spawnEnemy(defId: string, uidSeed: number): EnemyState {
  const def: EnemyDef = getEnemy(defId);
  return {
    uid: `${defId}#${uidSeed}`,
    defId, name: def.jp, hp: def.hp, maxHp: def.hp,
    tags: def.tags.slice(), resist: { ...def.resist },
    statuses: [], guard: 0, moves: def.moves,
  };
}

export function spawnBoss(bossId: string): EnemyState {
  const b: BossDef = getBoss(bossId);
  const p0 = b.phases[0]!;
  return {
    uid: `${bossId}#0`, defId: bossId, name: `${b.jp} — ${p0.name}`,
    hp: p0.hp, maxHp: p0.hp, tags: p0.tags.slice(), resist: { ...p0.resist },
    statuses: [], guard: 0, moves: p0.moves,
    phase: 0, phasesLeft: b.phases.slice(1),
  };
}

// ------------------------------------------------------------------ start
export function startCombat(
  ctx: CombatContext,
  spec: { enemyIds?: string[]; bossId?: string },
): CombatState {
  const { run, meta, rng } = ctx;
  const player = run.player;
  const pas = passives(player);
  const flags = synergyFlags(player);

  let enemies: EnemyState[];
  let isBoss = false;
  if (spec.bossId) {
    enemies = [spawnBoss(spec.bossId)];
    isBoss = true;
    // Loop-aware Vane prepares for the trick you always use (DESIGN §10.1).
    if (spec.bossId === "B_VANE" && knows(meta, "K017") && meta.totalRuns >= 10) {
      (run.npcFlags["N02"] ??= []).push("adapted");
    }
  } else {
    enemies = (spec.enemyIds ?? []).map((id, i) => spawnEnemy(id, i));
    // Assassin: ambush at night removes one body from the fight.
    const night = run.clock >= 20 * 60;
    if (pas.has("firstStrikeCrit") && night && enemies.length > 1) enemies.pop();
  }

  const state: CombatState = {
    enemies, turn: 1, phase: "player", intents: {},
    specialActions: [], isBoss, bossId: spec.bossId,
    log: [], usedSpecials: [],
    dodgeReady: pas.has("dodgeOnce"),
    firstStrikeUsed: false,
    allyActive: run.player.flags["ally"] === 1,
    negotiable: false,
  };

  if (pas.has("seeIntentDepth2") && !flags.has("intentDepth3")) {
    const cost = Math.floor(player.maxHp * 0.1);
    player.hp = Math.max(1, player.hp - cost);
    state.log.push(`読心の代償: HP −${cost}`);
  }

  player.guard = 0;
  player.focus = Math.min(player.maxFocus, 3);
  player.statuses = [];
  player.flags["bonusNext"] = 0;
  rollIntents(ctx, state);
  refreshSpecials(ctx, state);
  return state;
}

// ------------------------------------------------------------------ intents
export function rollIntents(ctx: CombatContext, state: CombatState): void {
  const pas = passives(ctx.run.player);
  const flags = synergyFlags(ctx.run.player);
  const seeValues = pas.has("seeIntentValues");
  const detect = pas.has("detectFeint") || flags.has("fullRead");

  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const move = ctx.rng.weighted(e.moves.map((m) => ({ item: m, weight: m.weight })));
    const isFeint = move.intent === "feint";
    const detected = isFeint && detect;
    const shown = isFeint && !detected ? (move.disguisedAs ?? "attack") : move.intent;
    const dmg = move.effects
      .filter((x): x is Extract<SkillEffect, { kind: "damage" }> => x.kind === "damage")
      .reduce((s, x) => s + x.base * (x.hits ?? 1), 0);
    const intent: Intent = {
      moveId: move.id,
      shown: detected ? "feint" : shown,
      actual: move.intent,
      isFeint,
      detected,
    };
    if (seeValues || detected) {
      intent.revealedName = move.name;
      if (dmg > 0) intent.revealedDamage = dmg;
    }
    state.intents[e.uid] = intent;
  }
}

/** Does the player currently know what this enemy will do?  Drives Assassin/Y02. */
export function intentKnown(player: PlayerState, intent: Intent | undefined): boolean {
  if (!intent) return false;
  const pas = passives(player);
  if (pas.has("seeIntentValues")) return true;
  if (intent.isFeint) return intent.detected;
  return false;
}

export function refreshSpecials(ctx: CombatContext, state: CombatState): void {
  const player = ctx.run.player;
  const flags = synergyFlags(player);
  const pas = passives(player);
  const list = specialActionsFor({
    meta: ctx.meta, run: ctx.run, enemies: state.enemies, isBoss: state.isBoss,
    bossId: state.bossId, synergyFlags: flags,
    hasItem: (id) => player.items.includes(id),
    hasSkill: (id) => player.skills.includes(id),
  });
  const extra: SpecialAction[] = [];
  if (pas.has("negotiate") && state.enemies.some((e) => e.hp > 0 && e.tags.includes("humanoid")) && !state.isBoss) {
    extra.push({
      id: "SA_TALK", label: "交渉する", source: "S04", sourceKind: "skill",
      reliability: "confirmed", desc: "人型の敵との戦闘を終わらせる。",
    });
  }
  state.specialActions = [...list, ...extra].filter((a) => !state.usedSpecials.includes(a.id));
  state.negotiable = state.specialActions.some((a) => a.id.includes("NEGOTIATE") || a.id === "SA_TALK");
}

// ------------------------------------------------------------------ damage
export interface DamageOpts {
  element?: Element;
  crit?: boolean;
  ignoreGuard?: boolean;
  fromPlayer: boolean;
}

export function elementMultiplier(meta: MetaState, target: EnemyState, element: Element): number {
  let mult = target.resist[element] ?? 1.0;
  if (element === "lightning" && (target.tags.includes("wet") || target.tags.includes("metal"))) {
    mult = Math.max(mult, 2.0);
  }
  // Knowledge can override the table — K009 on the second phase.
  for (const { effect, reliability } of activeEffects(meta)) {
    if (effect.kind !== "elementMultiplier") continue;
    if (effect.element !== element) continue;
    if (effect.target === "boss_phase2" && !target.tags.includes("phase2")) continue;
    if (reliability === "invalidated") continue;
    mult = Math.max(mult, effect.mult);
  }
  return mult;
}

export function dealDamageToEnemy(
  ctx: CombatContext, state: CombatState, target: EnemyState, base: number, opts: DamageOpts,
): number {
  const player = ctx.run.player;
  const element = opts.element ?? "physical";
  let raw = base + (opts.fromPlayer ? player.power : 0);
  if (opts.fromPlayer) raw += player.flags["bonusNext"] ?? 0;
  raw *= elementMultiplier(ctx.meta, target, element);
  if (opts.crit) raw *= CRIT_MULT;
  if (statusAmount(player.statuses, "weak") > 0 && opts.fromPlayer) raw *= 0.6;
  if (statusAmount(target.statuses, "vulnerable") > 0) raw *= 1.5;
  if (statusAmount(target.statuses, "mark") > 0) { raw *= CRIT_MULT; addStatus(target.statuses, "mark", -999); }
  raw *= ctx.rng.float(0.92, 1.08);

  let dealt = Math.max(1, Math.floor(raw));
  if (!opts.ignoreGuard && target.guard > 0) {
    const absorbed = Math.min(target.guard, dealt);
    target.guard -= absorbed;
    dealt -= absorbed;
  }
  target.hp = Math.max(0, target.hp - dealt);
  if (opts.fromPlayer) player.flags["bonusNext"] = 0;
  return dealt;
}

export function dealDamageToPlayer(
  ctx: CombatContext, state: CombatState, base: number, element: Element = "physical", ignoreGuard = false,
): number {
  const player = ctx.run.player;
  let raw = base;
  if (statusAmount(player.statuses, "vulnerable") > 0) raw *= 1.5;
  raw *= ctx.rng.float(0.92, 1.08);
  let dealt = Math.max(1, Math.floor(raw));

  if (state.dodgeReady) {
    state.dodgeReady = false;
    state.log.push("残響歩法: 攻撃を回避した");
    if (synergyFlags(player).has("critAfterDodge")) player.flags["dodgeCrit"] = 1;
    return 0;
  }
  if (!ignoreGuard && player.guard > 0) {
    const absorbed = Math.min(player.guard, dealt);
    player.guard -= absorbed;
    dealt -= absorbed;
  }
  player.hp -= dealt;

  if (player.hp <= 0 && passives(player).has("secondWind") && player.flags["secondWindUsed"] !== 1) {
    player.flags["secondWindUsed"] = 1;
    player.hp = Math.floor(player.maxHp * 0.3);
    state.log.push("第二の息: 倒れる寸前で息を吹き返した");
  }
  if (player.hp <= 0) { player.hp = 0; state.phase = "lost"; }
  return dealt;
}

// ------------------------------------------------------------------ actions
export type PlayerAction =
  | { kind: "attack"; targetUid: string }
  | { kind: "skill"; skillId: string; targetUid?: string }
  | { kind: "item"; itemId: string; targetUid?: string }
  | { kind: "defend" }
  | { kind: "special"; actionId: string; targetUid?: string }
  | { kind: "flee" };

export interface ActionResult {
  ok: boolean;
  message: string;
  lines: string[];
  endedTurn: boolean;
}

function livingTarget(state: CombatState, uid?: string): EnemyState | null {
  if (uid) {
    const e = state.enemies.find((x) => x.uid === uid && x.hp > 0);
    if (e) return e;
  }
  return state.enemies.find((e) => e.hp > 0) ?? null;
}

function applySkillEffects(
  ctx: CombatContext, state: CombatState, effects: SkillEffect[], target: EnemyState | null,
  lines: string[], crit: boolean, element?: Element,
): void {
  const player = ctx.run.player;
  for (const eff of effects) {
    switch (eff.kind) {
      case "damage": {
        const hits = eff.hits ?? 1;
        for (let i = 0; i < hits; i++) {
          const t = target && target.hp > 0 ? target : livingTarget(state);
          if (!t) break;
          const d = dealDamageToEnemy(ctx, state, t, eff.base, { element: element ?? eff.element, crit, fromPlayer: true });
          lines.push(`${t.name} に ${d} ダメージ${crit ? "（クリティカル）" : ""}`);
          onEnemyMaybeDead(ctx, state, t, lines);
        }
        break;
      }
      case "status": {
        if (eff.target === "self") { addStatus(player.statuses, eff.status, eff.amount); lines.push(`自分に ${eff.status} ${eff.amount}`); }
        else {
          const t = target && target.hp > 0 ? target : livingTarget(state);
          if (t) { addStatus(t.statuses, eff.status, eff.amount); lines.push(`${t.name} に ${eff.status} ${eff.amount}`); }
        }
        break;
      }
      case "guard": {
        const pas = passives(player);
        const amt = pas.has("guardDouble") ? eff.amount * 2 : eff.amount;
        player.guard += amt; lines.push(`Guard +${amt}`);
        break;
      }
      case "heal": {
        const before = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + eff.amount);
        lines.push(`HP +${player.hp - before}`);
        break;
      }
      case "payHp": {
        player.hp = Math.max(1, player.hp - eff.amount);
        lines.push(`HP −${eff.amount}`);
        if (synergyFlags(player).has("bloodPriceGuard")) { player.guard += eff.amount; lines.push(`鉄の代償: Guard +${eff.amount}`); }
        break;
      }
      case "bonusNextAttack":
        player.flags["bonusNext"] = (player.flags["bonusNext"] ?? 0) + eff.amount;
        lines.push(`次の攻撃 +${eff.amount}`);
        break;
      case "focus":
        player.focus = Math.min(player.maxFocus, player.focus + eff.amount);
        break;
    }
  }
}

function onEnemyMaybeDead(ctx: CombatContext, state: CombatState, e: EnemyState, lines: string[]): void {
  if (e.hp > 0) return;
  // Boss phase transition
  if (e.phasesLeft && e.phasesLeft.length > 0) {
    const next = e.phasesLeft.shift()!;
    const boss = getBoss(e.defId);
    e.phase = (e.phase ?? 0) + 1;
    e.name = `${boss.jp} — ${next.name}`;
    e.hp = next.hp; e.maxHp = next.hp;
    e.tags = next.tags.slice(); e.resist = { ...next.resist };
    e.moves = next.moves; e.guard = 0; e.statuses = [];
    lines.push(`── ${next.name} ──`);
    rollIntents(ctx, state);
    refreshSpecials(ctx, state);
    return;
  }
  lines.push(`${e.name} を倒した`);
  const pas = passives(ctx.run.player);
  if (pas.has("necromancy")) {
    const echoCap = synergyFlags(ctx.run.player).has("corpseKnowledgeConfirmed") ? 3 : 2;
    if (ctx.run.player.echoes.length < echoCap) {
      ctx.run.player.echoes.push("S02");
      lines.push("死霊術: Echo を 1 つ得た");
    }
  }
  if (synergyFlags(ctx.run.player).has("corpseLoot")) {
    const g = ctx.rng.int(8, 18);
    ctx.run.player.gold += g;
    lines.push(`墓荒らし: Gold +${g}`);
  }
}

export function playerAction(ctx: CombatContext, state: CombatState, action: PlayerAction): ActionResult {
  if (state.phase !== "player") return { ok: false, message: "今は行動できない", lines: [], endedTurn: false };
  const player = ctx.run.player;
  const flags = synergyFlags(player);
  const pas = passives(player);
  const lines: string[] = [];

  if (statusAmount(player.statuses, "fear") > 0) {
    lines.push("恐怖で動けない");
    decayStatuses(player.statuses, ["fear"]);
    return endPlayerTurn(ctx, state, lines);
  }

  switch (action.kind) {
    case "attack": {
      const t = livingTarget(state, action.targetUid);
      if (!t) return { ok: false, message: "対象がいない", lines: [], endedTurn: false };
      const known = intentKnown(player, state.intents[t.uid]);
      let crit = false;
      if (pas.has("firstStrikeCrit") && known && !state.firstStrikeUsed) { crit = true; state.firstStrikeUsed = true; lines.push("暗殺者: 先制クリティカル"); }
      if (flags.has("alwaysCritOnKnownIntent") && known) { crit = true; lines.push("予見殺: クリティカル"); }
      if (player.flags["dodgeCrit"] === 1) { crit = true; player.flags["dodgeCrit"] = 0; addStatus(t.statuses, "mark", 1); lines.push("影撃: クリティカル + Mark"); }
      const d = dealDamageToEnemy(ctx, state, t, 10, { crit, fromPlayer: true });
      lines.push(`${t.name} に ${d} ダメージ${crit ? "（クリティカル）" : ""}`);
      if (pas.has("burnOnHit")) { addStatus(t.statuses, "burn", 3); lines.push("松明: Burn 3"); }
      if (pas.has("poisonOnHit")) { addStatus(t.statuses, "poison", 3); lines.push("毒使い: Poison 3"); }
      if (pas.has("steal") && !state.usedSpecials.includes("stole")) {
        state.usedSpecials.push("stole");
        const g = ctx.rng.int(10, 24); player.gold += g; lines.push(`盗人の指: Gold +${g}`);
      }
      onEnemyMaybeDead(ctx, state, t, lines);
      player.focus = Math.min(player.maxFocus, player.focus + 1);
      return endPlayerTurn(ctx, state, lines);
    }
    case "skill": {
      const isEcho = player.echoes.includes(action.skillId) && !player.skills.includes(action.skillId);
      const skill = getSkill(action.skillId);
      if (!isEcho && !player.skills.includes(skill.id)) return { ok: false, message: "所持していない", lines: [], endedTurn: false };
      if (!skill.active) return { ok: false, message: `${skill.jp} は常時発動型`, lines: [], endedTurn: false };
      if (player.focus < skill.focusCost) return { ok: false, message: "Focus が足りない", lines: [], endedTurn: false };
      player.focus -= skill.focusCost;
      if (isEcho) player.echoes.splice(player.echoes.indexOf(action.skillId), 1);

      const t = livingTarget(state, action.targetUid);
      if (skill.id === "S04") {
        if (t && t.tags.includes("humanoid") && !state.isBoss) {
          state.phase = "fled"; lines.push("交渉成立。戦わずに済んだ。");
          return { ok: true, message: "交渉成立", lines, endedTurn: true };
        }
        lines.push("交渉は通じない相手だ");
        return endPlayerTurn(ctx, state, lines);
      }
      const known = t ? intentKnown(player, state.intents[t.uid]) : false;
      const crit = flags.has("alwaysCritOnKnownIntent") && known;
      if (skill.target === "allEnemies") {
        for (const e of state.enemies.filter((x) => x.hp > 0)) applySkillEffects(ctx, state, skill.effects, e, lines, crit);
      } else {
        applySkillEffects(ctx, state, skill.effects, t, lines, crit);
      }
      lines.unshift(`${skill.jp}`);
      return endPlayerTurn(ctx, state, lines);
    }
    case "item": {
      const idx = player.items.indexOf(action.itemId);
      if (idx < 0) return { ok: false, message: "所持していない", lines: [], endedTurn: false };
      const item = getItem(action.itemId);
      if (item.kind === "relic") return { ok: false, message: "常時効果アイテム", lines: [], endedTurn: false };
      player.items.splice(idx, 1);
      const t = livingTarget(state, action.targetUid);
      lines.push(`${item.jp} を使った`);
      if (item.id === "I_SMOKEBOMB") { state.phase = "fled"; return { ok: true, message: "離脱", lines, endedTurn: true }; }
      if (item.id === "I_ANTIDOTE") {
        player.statuses = player.statuses.filter((s) => s.kind !== "poison" && s.kind !== "bleed");
        lines.push("毒と出血が消えた");
      }
      applySkillEffects(ctx, state, item.effects, t, lines, false);
      if (item.quick) return { ok: true, message: item.jp, lines, endedTurn: false };
      return endPlayerTurn(ctx, state, lines);
    }
    case "defend": {
      const base = 6 + player.level * 2;
      const amt = pas.has("guardDouble") ? base * 2 : base;
      player.guard += amt;
      player.focus = Math.min(player.maxFocus, player.focus + 2);
      lines.push(`身構えた（Guard +${amt}）`);
      return endPlayerTurn(ctx, state, lines);
    }
    case "flee": {
      state.phase = "fled";
      return { ok: true, message: "逃走した", lines: ["逃走した（1時間を失った）"], endedTurn: true };
    }
    case "special":
      return useSpecial(ctx, state, action.actionId, action.targetUid);
  }
}

function useSpecial(ctx: CombatContext, state: CombatState, actionId: string, targetUid?: string): ActionResult {
  const player = ctx.run.player;
  const lines: string[] = [];
  const sa = state.specialActions.find((a) => a.id === actionId);
  if (!sa) return { ok: false, message: "使用できない", lines: [], endedTurn: false };
  state.usedSpecials.push(actionId);

  // The gamble: unreliable knowledge can simply be wrong.
  if (!procKnowledge(sa.reliability, ctx.rng)) {
    lines.push(sa.reliability === "invalidated"
      ? "……その未来はもう存在しない。"
      : "……記憶違いだったらしい。何も起きない。");
    refreshSpecials(ctx, state);
    return endPlayerTurn(ctx, state, lines);
  }

  const t = livingTarget(state, targetUid);
  switch (actionId) {
    case "SA_TORCH": {
      if (!t) break;
      const adapted = ctx.run.npcFlags["N02"]?.includes("adapted");
      addStatus(t.statuses, "fear", adapted ? 1 : 1);
      addStatus(t.statuses, "burn", adapted ? 3 : 6);
      lines.push(adapted
        ? "ヴェインは炎から目を逸らさない。だが剣先は確かに揺れた。"
        : "松明を突きつける。ヴェインが後ずさった。");
      break;
    }
    case "SA_EXPOSE_PRINCESS": {
      if (!t) break;
      t.guard = 0;
      if (t.tags.includes("shielded")) {
        t.tags = t.tags.filter((x) => x !== "shielded");
        addStatus(t.statuses, "vulnerable", 3);
        lines.push("影武者の盾が崩れた。");
      } else {
        addStatus(t.statuses, "fear", 1);
        lines.push("その一言で、相手の構えが崩れた。");
      }
      break;
    }
    case "SA_LIGHTNING": {
      if (!t) break;
      const d = dealDamageToEnemy(ctx, state, t, 34, { element: "lightning", fromPlayer: false });
      lines.push(`雷が鋼を内側から焼く。${d} ダメージ`);
      onEnemyMaybeDead(ctx, state, t, lines);
      break;
    }
    case "SA_HOLYWATER_KILL": {
      const undead = state.enemies.find((e) => e.hp > 0 && e.tags.includes("undead"));
      const i = player.items.indexOf("I_HOLYWATER");
      if (i >= 0) player.items.splice(i, 1);
      if (undead) {
        undead.hp = 0;
        lines.push(`聖水。${undead.name} は崩れ落ちた。`);
        onEnemyMaybeDead(ctx, state, undead, lines);
      }
      break;
    }
    case "SA_NEGOTIATE_KNOWN":
    case "SA_TALK": {
      state.phase = "fled";
      lines.push("戦わずに済んだ。");
      return { ok: true, message: "交渉成立", lines, endedTurn: true };
    }
    case "SA_ROYAL_DEAL": {
      state.phase = "fled";
      lines.push("王家の名を出した途端、相手は剣を鞘に戻した。");
      return { ok: true, message: "ボス戦を回避した", lines, endedTurn: true };
    }
    case "SA_DETONATE": {
      if (!t) break;
      const total = t.statuses.reduce((s, x) => s + (x.kind === "burn" || x.kind === "poison" || x.kind === "bleed" ? x.amount : 0), 0);
      t.statuses = t.statuses.filter((x) => x.kind !== "burn" && x.kind !== "poison" && x.kind !== "bleed");
      const d = dealDamageToEnemy(ctx, state, t, total * 3, { element: "fire", ignoreGuard: true, fromPlayer: false });
      lines.push(`嵐火が爆ぜる。${d} ダメージ`);
      onEnemyMaybeDead(ctx, state, t, lines);
      break;
    }
  }
  refreshSpecials(ctx, state);
  return endPlayerTurn(ctx, state, lines);
}

// ------------------------------------------------------------------ turn flow
function endPlayerTurn(ctx: CombatContext, state: CombatState, lines: string[]): ActionResult {
  const player = ctx.run.player;
  if (state.enemies.every((e) => e.hp <= 0)) {
    state.phase = "won";
    state.log.push(...lines);
    return { ok: true, message: "勝利", lines, endedTurn: true };
  }
  // End-of-player-turn ticks on enemies.
  for (const e of state.enemies.filter((x) => x.hp > 0)) {
    const burn = statusAmount(e.statuses, "burn");
    if (burn > 0) { e.hp = Math.max(0, e.hp - burn); lines.push(`${e.name} は燃えている（${burn}）`); onEnemyMaybeDead(ctx, state, e, lines); }
    const poison = statusAmount(e.statuses, "poison");
    if (poison > 0) { e.hp = Math.max(0, e.hp - poison); lines.push(`${e.name} は毒に蝕まれている（${poison}）`); onEnemyMaybeDead(ctx, state, e, lines); }
    decayStatuses(e.statuses, ["burn", "weak", "vulnerable", "fear"]);
  }
  if (state.enemies.every((e) => e.hp <= 0)) {
    state.phase = "won"; state.log.push(...lines);
    return { ok: true, message: "勝利", lines, endedTurn: true };
  }

  state.phase = "enemy";
  lines.push(...enemyTurn(ctx, state));
  state.log.push(...lines);
  return { ok: true, message: "", lines, endedTurn: true };
}

function enemyTurn(ctx: CombatContext, state: CombatState): string[] {
  const player = ctx.run.player;
  const pas = passives(player);
  const lines: string[] = [];

  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    if (statusAmount(e.statuses, "fear") > 0) {
      lines.push(`${e.name} は動けない`);
      continue;
    }
    // Guard protects through the player's turn and then expires, exactly as the
    // player's does.  Without this, defensive bosses stack Guard forever.
    e.guard = 0;

    const intent = state.intents[e.uid];
    const move: EnemyMove | undefined = e.moves.find((m) => m.id === intent?.moveId) ?? e.moves[0];
    if (!move) continue;
    lines.push(`${e.name}: ${move.name}`);
    const bleed = statusAmount(e.statuses, "bleed");
    if (bleed > 0) { e.hp = Math.max(0, e.hp - bleed); }

    for (const eff of move.effects) {
      switch (eff.kind) {
        case "damage": {
          const hits = eff.hits ?? 1;
          let mult = 1;
          if (statusAmount(e.statuses, "weak") > 0) mult *= 0.6;
          if (state.allyActive) mult *= 0.7;
          for (let i = 0; i < hits; i++) {
            const d = dealDamageToPlayer(ctx, state, eff.base * mult, eff.element);
            lines.push(d > 0 ? `${d} ダメージを受けた` : "かわした");
            if (state.phase === "lost") return lines;
          }
          break;
        }
        case "status":
          addStatus(player.statuses, eff.status, eff.amount);
          lines.push(`${eff.status} ${eff.amount} を受けた`);
          break;
        case "guard":
          e.guard += eff.amount;
          break;
        case "heal":
          e.hp = Math.min(e.maxHp, e.hp + eff.amount);
          break;
      }
    }
  }

  // Player end-of-round ticks.
  const burn = statusAmount(player.statuses, "burn");
  if (burn > 0) { dealDamageToPlayer(ctx, state, burn, "fire", true); lines.push(`燃えている（${burn}）`); }
  const poison = statusAmount(player.statuses, "poison");
  if (poison > 0) { dealDamageToPlayer(ctx, state, poison, "poison", true); lines.push(`毒（${poison}）`); }
  if (state.phase === "lost") return lines;

  // A fight cannot be stalled out.  Past turn 12 exhaustion sets in and
  // ignores Guard entirely, so turtling is a delay, never a win condition.
  if (state.turn >= 12) {
    const fatigue = (state.turn - 11) * 3;
    dealDamageToPlayer(ctx, state, fatigue, "physical", true);
    lines.push(`長引いた戦いが体力を削る（${fatigue}）`);
    if ((state.phase as string) === "lost") return lines;
  }

  decayStatuses(player.statuses, ["burn", "bleed", "weak", "vulnerable", "fear"]);
  if (!pas.has("guardCarry")) player.guard = 0;
  player.focus = Math.min(player.maxFocus, player.focus + 2);
  state.turn++;
  state.phase = "player";
  rollIntents(ctx, state);
  refreshSpecials(ctx, state);
  return lines;
}

// ------------------------------------------------------------------ rewards
export function combatRewards(ctx: CombatContext, state: CombatState): { gold: number; xp: number } {
  let gold = 0, xp = 0;
  for (const e of state.enemies) {
    if (state.isBoss) { gold += 120; xp += 80; continue; }
    const def = getEnemy(e.defId);
    gold += ctx.rng.int(def.gold[0], def.gold[1]);
    xp += def.xp;
  }
  return { gold, xp };
}
