import type {
  MetaState, RunState, GameState, MapNode, Scene, RunReport, RewardOffer,
  SpecialAction, Reliability,
} from "../types.js";
import type { LLMProvider } from "../llm/provider.js";
import { MockLLMProvider } from "../llm/mock.js";
import {
  newMeta, startRun, nodeOptions, enterNode, resolveChoice, takeReward,
  doCombatAction, buildReport, availableRewrites, applyRewrite, currentNode,
  clockString, onDeath, dejaVuStage, RUN_DEADLINE,
} from "./run.js";
import { performFreeAction, buildWorldContext } from "./freeAction.js";
import type { PlayerAction } from "./combat.js";
import { SKILLS, getSkill, SYNERGIES, activeSynergies } from "../content/skills.js";
import { getItem, NPC_BY_ID, WORLD_TRUTHS, ENDINGS } from "../content/world.js";
import { getKnowledge, KNOWLEDGE, nearSynthesis } from "../content/knowledge.js";
import { getBoss } from "../content/enemies.js";
import type { Acquisition } from "./knowledge.js";

export type Screen = "title" | "scene" | "map" | "combat" | "reward" | "report";

export interface KnowledgeCard {
  id: string; title: string; description: string;
  reliability: Reliability; synthesized: boolean; upgradedFrom?: Reliability;
  effects: string[]; truths: string[];
}

export interface GameEvent {
  type: "knowledge" | "synergy" | "rewrite" | "line" | "narrative" | "death" | "ending";
  text?: string;
  card?: KnowledgeCard;
  lines?: string[];
}

export interface View {
  screen: Screen;
  provider: string;
  meta: {
    totalRuns: number;
    distortion: number;
    distortionVisible: boolean;
    knowledge: { id: string; title: string; reliability: Reliability; tags: string[]; effects: string[] }[];
    nearSynthesis: { id: string; title: string; missing: string[] }[];
    truths: { id: string; statement: string; revealed: boolean }[];
    endings: { id: string; name: string; unlocked: boolean }[];
    executedRewrites: string[];
  };
  run?: {
    runNumber: number; clock: string; clockMinutes: number; deadline: number;
    step: number; totalSteps: number;
    hp: number; maxHp: number; focus: number; maxFocus: number; guard: number;
    level: number; xp: number; gold: number; power: number;
    suspicion: number; freeActionsLeft: number;
    skills: { id: string; jp: string; desc: string; worldDesc?: string; focusCost: number; active: boolean }[];
    echoes: string[];
    items: { id: string; jp: string; desc: string; kind: string; quick: boolean }[];
    statuses: { kind: string; amount: number }[];
    synergies: { id: string; jp: string; desc: string }[];
    boss: string;
    worldDeltas: string[];
    log: { clock: string; text: string; kind: string }[];
  };
  options?: (MapNode & { locked?: boolean })[];
  scene?: Scene & { rewrites?: { id: string; title: string; utterance: string; preview: string[] }[] };
  combat?: {
    turn: number;
    enemies: {
      uid: string; name: string; hp: number; maxHp: number; guard: number;
      statuses: { kind: string; amount: number }[];
      intent: { shown: string; label: string; damage?: number; detected: boolean };
    }[];
    specials: SpecialAction[];
    isBoss: boolean;
    log: string[];
  };
  reward?: {
    kind: string;
    skills?: { id: string; jp: string; desc: string; worldDesc?: string; synergy?: string }[];
    items?: { id: string; jp: string; desc: string }[];
  };
  report?: RunReport;
  events: GameEvent[];
}

const INTENT_LABEL: Record<string, string> = {
  attack: "攻撃", heavy: "強攻撃", defend: "防御", debuff: "弱体", special: "特殊", feint: "フェイント（看破）",
};

export class Game {
  state: GameState;
  provider: LLMProvider;
  private events: GameEvent[] = [];
  private screen: Screen = "title";
  private report: RunReport | null = null;

  constructor(provider?: LLMProvider, meta?: MetaState) {
    this.provider = provider ?? new MockLLMProvider();
    this.state = { meta: meta ?? newMeta(), run: null };
  }

  // ------------------------------------------------------------- lifecycle
  async startRun(seed?: string): Promise<View> {
    this.events = [];
    this.report = null;
    const s = seed ?? `run-${this.state.meta.totalRuns + 1}-${Date.now().toString(36)}`;
    this.state.run = startRun(this.state.meta, s);
    this.screen = "scene";
    await this.narrate("run_start");
    return this.view();
  }

  async enter(nodeId: string): Promise<View> {
    this.events = [];
    const run = this.requireRun();
    const res = enterNode(this.state.meta, run, nodeId);
    this.pushLines(res.lines);
    this.pushAcquisitions(res.acquisitions ?? []);
    if (run.outcome !== "running") return this.toReport();
    if (res.combatStarted) this.screen = "combat";
    else if (run.pendingReward) this.screen = "reward";
    else if (run.pendingScene) { this.screen = "scene"; await this.narrate("node_enter"); }
    else this.screen = "map";
    return this.view();
  }

  async choose(actionId: string): Promise<View> {
    this.events = [];
    const run = this.requireRun();
    const res = resolveChoice(this.state.meta, run, actionId);
    this.pushLines(res.lines);
    this.pushAcquisitions(res.acquisitions);
    if (res.rewriteApplied) {
      this.events.push({ type: "rewrite", text: res.rewriteApplied, lines: res.lines });
      await this.narrateRewrite(res.rewriteApplied);
    }
    if (run.outcome !== "running") return this.toReport();
    if (run.pendingReward) this.screen = "reward";
    else if (res.sceneClosed) this.screen = "map";
    return this.view();
  }

  async combat(action: PlayerAction): Promise<View> {
    this.events = [];
    const run = this.requireRun();
    const res = doCombatAction(this.state.meta, run, action);
    if (!res.ok) { this.events.push({ type: "line", text: res.message }); return this.view(); }
    this.pushLines(res.lines);
    this.pushAcquisitions(res.acquisitions ?? []);
    if (run.outcome !== "running") return this.toReport();
    if (res.resolved) this.screen = run.pendingReward ? "reward" : "map";
    return this.view();
  }

  async reward(choice: string | null): Promise<View> {
    this.events = [];
    const run = this.requireRun();
    const lines = takeReward(this.state.meta, run, choice);
    this.pushLines(lines);
    for (const l of lines) if (l.startsWith("⚡")) this.events.push({ type: "synergy", text: l });
    run.activeSynergies = activeSynergies(run.player.skills).map((s) => s.id);
    this.screen = "map";
    return this.view();
  }

  async free(raw: string): Promise<View> {
    this.events = [];
    const run = this.requireRun();
    const res = await performFreeAction(this.state.meta, run, this.provider, raw);
    this.events.push({ type: "line", text: `▸ ${res.intent.intentSummary}（${res.intent.verb} / ${res.outcome}）` });
    this.pushLines(res.lines);
    this.pushAcquisitions(res.acquisitions);
    if (res.rewriteApplied) this.events.push({ type: "rewrite", text: res.rewriteApplied, lines: res.lines });
    await this.narrate(res.beat);
    if (run.outcome !== "running") return this.toReport();
    if (res.combatStarted) this.screen = "combat";
    return this.view();
  }

  async rewrite(rewriteId: string): Promise<View> {
    this.events = [];
    const run = this.requireRun();
    const res = applyRewrite(this.state.meta, run, rewriteId);
    this.pushLines(res.lines);
    this.events.push({ type: "rewrite", text: rewriteId, lines: res.lines });
    await this.narrateRewrite(rewriteId);
    if (run.pendingScene) {
      run.pendingScene.choices = run.pendingScene.choices.filter((c) => c.actionId !== `REWRITE:${rewriteId}`);
    }
    return this.view();
  }

  giveUp(): View {
    this.events = [];
    const run = this.requireRun();
    onDeath(this.state.meta, run, "自ら歩みを止めた");
    return this.toReport();
  }

  private toReport(): View {
    const run = this.requireRun();
    this.report = buildReport(this.state.meta, run);
    this.screen = "report";
    this.events.push({ type: run.outcome === "dead" ? "death" : "ending", text: this.report.epitaph });
    return this.view();
  }

  // ------------------------------------------------------------- narration
  private async narrate(beat: string): Promise<void> {
    const run = this.state.run;
    if (!run || !run.pendingScene) return;
    const ctx = buildWorldContext(this.state.meta, run, run.pendingScene.speaker);
    try {
      const n = await this.provider.generateNarrative({ context: ctx, beat });
      run.pendingScene.narrative = n.narrative;
      run.pendingScene.foreshadowing = n.foreshadowing;
      run.pendingScene.aiGenerated = this.provider.name !== "mock";
      if (run.pendingScene.speaker) {
        const allowed = run.pendingScene.choices.map((c) => ({ id: c.actionId, hint: c.label }));
        const r = await this.provider.generateReaction({ context: ctx, event: beat, allowedActionIds: allowed });
        run.pendingScene.dialogue = r.dialogue;
        run.pendingScene.mood = r.mood;
        for (const c of r.choices) {
          const target = run.pendingScene.choices.find((x) => x.actionId === c.actionId);
          if (target && !target.actionId.startsWith("REWRITE:") && !target.actionId.startsWith("BUY")) {
            target.label = c.label;
          }
        }
      }
      this.events.push({ type: "narrative", text: n.narrative });
    } catch {
      /* narration is cosmetic; a failure must never block play */
    }
  }

  private async narrateRewrite(rewriteId: string): Promise<void> {
    const run = this.state.run;
    if (!run) return;
    const ctx = buildWorldContext(this.state.meta, run);
    // The model may only pick from an engine-authored menu, with engine-set magnitudes.
    const allowed = [
      { id: "rumor_spreads", label: "噂が広まる" },
      { id: "npc_relocates", label: "NPC が場所を変える" },
      { id: "guard_increases", label: "警備が強まる" },
      { id: "someone_watches", label: "誰かが見ている" },
    ];
    try {
      const c = await this.provider.proposeConsequences({
        context: ctx, change: rewriteId, allowedPrimitives: allowed,
      });
      const delta = run.worldDeltas[run.worldDeltas.length - 1];
      if (delta) delta.narrative = c.narrative;
      this.events.push({ type: "narrative", text: c.narrative });
      for (const p of c.picks) {
        const label = allowed.find((a) => a.id === p.primitiveId)?.label ?? p.primitiveId;
        // Magnitudes are bounded by the engine, never by the model.
        const amount = p.magnitude === "high" ? 2 : 1;
        if (p.primitiveId === "guard_increases") run.regionDanger["castle"] = (run.regionDanger["castle"] ?? 0) + amount;
        if (p.primitiveId === "someone_watches") run.suspicion += amount;
        this.events.push({ type: "line", text: `― ${label}` });
      }
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------- helpers
  private requireRun(): RunState {
    if (!this.state.run) throw new Error("no active run");
    return this.state.run;
  }

  private pushLines(lines: string[]): void {
    for (const l of lines) this.events.push({ type: "line", text: l });
  }

  private pushAcquisitions(acqs: Acquisition[]): void {
    for (const a of acqs) {
      this.events.push({
        type: "knowledge",
        card: {
          id: a.id, title: a.def.title, description: a.def.description,
          reliability: a.reliability, synthesized: a.synthesized,
          upgradedFrom: a.upgradedFrom,
          effects: a.effectLabels, truths: a.truthsDisclosed,
        },
      });
    }
  }

  // ------------------------------------------------------------- view
  view(): View {
    const meta = this.state.meta;
    const run = this.state.run;
    const held = new Set(Object.keys(meta.knowledge));

    const v: View = {
      screen: this.screen,
      provider: this.provider.name,
      meta: {
        totalRuns: meta.totalRuns,
        distortion: meta.distortion,
        distortionVisible: !!meta.knowledge["K019"],
        knowledge: Object.entries(meta.knowledge).map(([id, rec]) => {
          const def = getKnowledge(id);
          return { id, title: def.title, reliability: rec.reliability, tags: def.tags, effects: def.effectLabels };
        }).sort((a, b) => a.id.localeCompare(b.id)),
        nearSynthesis: nearSynthesis(held).map((n) => ({
          id: n.id, title: getKnowledge(n.id).title,
          missing: n.missing.map((m) => getKnowledge(m).title),
        })),
        truths: WORLD_TRUTHS.map((t) => ({
          id: t.id,
          statement: meta.worldTruthDisclosure[t.id] ? t.statement : "???",
          revealed: !!meta.worldTruthDisclosure[t.id],
        })),
        endings: ENDINGS.map((e) => ({ id: e.id, name: e.name, unlocked: meta.unlockedEndings.includes(e.id) })),
        executedRewrites: meta.executedRewrites,
      },
      events: this.events,
    };

    if (run) {
      v.run = {
        runNumber: run.runNumber, clock: clockString(run.clock), clockMinutes: run.clock, deadline: RUN_DEADLINE,
        step: run.step, totalSteps: run.map.steps.length - 1,
        hp: run.player.hp, maxHp: run.player.maxHp, focus: run.player.focus, maxFocus: run.player.maxFocus,
        guard: run.player.guard, level: run.player.level, xp: run.player.xp, gold: run.player.gold,
        power: run.player.power, suspicion: run.suspicion, freeActionsLeft: run.freeActionsLeft,
        skills: run.player.skills.map((id) => {
          const s = getSkill(id);
          return { id, jp: s.jp, desc: s.desc, worldDesc: s.worldDesc, focusCost: s.focusCost, active: s.active };
        }),
        echoes: run.player.echoes,
        items: run.player.items.map((id) => {
          const i = getItem(id);
          return { id, jp: i.jp, desc: i.desc, kind: i.kind, quick: !!i.quick };
        }),
        statuses: run.player.statuses.map((s) => ({ kind: s.kind, amount: s.amount })),
        synergies: run.activeSynergies.map((id) => {
          const s = SYNERGIES.find((x) => x.id === id)!;
          return { id, jp: s.jp, desc: s.desc };
        }),
        boss: getBoss(run.map.bossId).jp,
        worldDeltas: run.worldDeltas.map((d) => d.summary),
        log: run.log.slice(-24).map((l) => ({ clock: clockString(l.clock), text: l.text, kind: l.kind })),
      };

      if (this.screen === "map") v.options = nodeOptions(run);
      if (this.screen === "scene" && run.pendingScene) {
        v.scene = {
          ...run.pendingScene,
          rewrites: availableRewrites(meta, run).map((r) => ({
            id: r.id, title: r.title, utterance: r.utterance, preview: r.preview,
          })),
        };
      }
      if (this.screen === "combat" && run.combat) {
        const c = run.combat;
        v.combat = {
          turn: c.turn, isBoss: c.isBoss, specials: c.specialActions, log: c.log.slice(-12),
          enemies: c.enemies.filter((e) => e.hp > 0).map((e) => {
            const i = c.intents[e.uid];
            return {
              uid: e.uid, name: e.name, hp: e.hp, maxHp: e.maxHp, guard: e.guard,
              statuses: e.statuses.map((s) => ({ kind: s.kind, amount: s.amount })),
              intent: {
                shown: i?.shown ?? "attack",
                label: i?.revealedName ?? INTENT_LABEL[i?.shown ?? "attack"] ?? "？",
                damage: i?.revealedDamage,
                detected: !!i?.detected,
              },
            };
          }),
        };
      }
      if (this.screen === "reward" && run.pendingReward) {
        const r: RewardOffer = run.pendingReward;
        v.reward = {
          kind: r.kind,
          skills: r.skillIds?.map((id, idx) => {
            const s = getSkill(id);
            return { id, jp: s.jp, desc: s.desc, worldDesc: s.worldDesc, synergy: r.synergyHints?.[idx] };
          }),
          items: r.itemIds?.map((id) => {
            const i = getItem(id);
            return { id, jp: i.jp, desc: i.desc };
          }),
        };
      }
    }
    if (this.screen === "report" && this.report) v.report = this.report;
    return v;
  }
}
