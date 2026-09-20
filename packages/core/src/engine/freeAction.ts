import type { MetaState, RunState, KnowledgeId } from "../types.js";
import type { LLMProvider, InterpretResponse, WorldContext } from "../llm/provider.js";
import { NPC_BY_ID, WORLD_TRUTHS, getItem, ITEMS } from "../content/world.js";
import { getKnowledge, KNOWLEDGE } from "../content/knowledge.js";
import { knows, grantKnowledge, type Acquisition } from "./knowledge.js";
import { currentNode, applyRewrite, dejaVuStage, startBoss, onDeath } from "./run.js";
import { startCombat } from "./combat.js";
import { Rng } from "../rng.js";

/**
 * Free-form action pipeline.
 *
 *   raw text -> LLM (structuring ONLY) -> engine adjudication -> result
 *
 * The model never decides whether something works.  It only says what the
 * player appears to be attempting (DESIGN §14).
 */

export type Outcome = "success" | "partial" | "informative";

export interface FreeActionResult {
  outcome: Outcome;
  intent: InterpretResponse;
  lines: string[];
  acquisitions: Acquisition[];
  combatStarted?: boolean;
  rewriteApplied?: string;
  timeCost: number;
  /** engine-picked beat string for the narrator */
  beat: string;
}

export function buildWorldContext(meta: MetaState, run: RunState, npcId?: string): WorldContext {
  const node = currentNode(run);
  const npc = npcId ? NPC_BY_ID.get(npcId) : undefined;
  return {
    worldTruths: WORLD_TRUTHS.map((t) => ({
      id: t.id, statement: t.statement, revealed: !!meta.worldTruthDisclosure[t.id],
    })),
    npc: npc ? {
      id: npc.id, name: npc.jp, publicGoal: npc.publicGoal,
      trueGoal: meta.worldTruthDisclosure["WT01"] || run.player.skills.includes("S13") ? npc.trueGoal : undefined,
      personality: npc.personality,
      trust: run.npcTrust[npc.id] ?? 0,
      dejaVuStage: dejaVuStage(meta, npc.id),
      knownLies: npc.lies,
    } : undefined,
    state: {
      clock: `${String(Math.floor(run.clock / 60) % 24).padStart(2, "0")}:${String(run.clock % 60).padStart(2, "0")}`,
      location: node?.name ?? "村アシュメア",
      act: node?.act ?? 0,
      playerHpPct: Math.round((run.player.hp / run.player.maxHp) * 100),
      suspicion: run.suspicion,
      distortion: meta.distortion,
      runNumber: run.runNumber,
    },
    knowledge: Object.entries(meta.knowledge).map(([id, rec]) => ({
      id, title: getKnowledge(id).title, reliability: rec.reliability,
    })),
    changedHistory: run.worldDeltas.map((d) => ({ rewriteId: d.rewriteId, summary: d.summary })),
  };
}

export function knownTargets(meta: MetaState, run: RunState): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const node = currentNode(run);
  for (const npc of NPC_BY_ID.values()) {
    if (run.deadNpcs.includes(npc.id)) continue;
    out.push({ id: npc.id, label: npc.jp });
  }
  out.push({ id: "PRINCESS", label: "王女" });
  out.push({ id: "KING", label: "王" });
  out.push({ id: "DOG", label: "犬" });
  out.push({ id: "SELF", label: "自分" });
  if (node) out.push({ id: node.id, label: node.name });
  if (run.combat) for (const e of run.combat.enemies) out.push({ id: e.uid, label: e.name });
  if (node?.region === "forest" || node?.region === "road") out.push({ id: "BRIDGE", label: "吊り橋" });
  if (node?.region === "sewer") out.push({ id: "GRATE", label: "鉄格子" });
  if (node?.region === "castle") out.push({ id: "MEAL", label: "料理" });
  return out;
}

export function knownInstruments(run: RunState): { id: string; label: string }[] {
  const items = run.player.items.map((i) => ({ id: i, label: getItem(i).jp }));
  const skills = run.player.skills.map((s) => ({ id: s, label: s }));
  return [...items, ...skills, { id: "WEAPON", label: "剣" }, { id: "WORDS", label: "言葉" }];
}

export async function performFreeAction(
  meta: MetaState, run: RunState, provider: LLMProvider, raw: string,
): Promise<FreeActionResult> {
  const ctx = buildWorldContext(meta, run, currentNode(run)?.npcId);
  const targets = knownTargets(meta, run);
  const instruments = knownInstruments(run);
  const intent = await provider.interpretAction({ context: ctx, raw, knownTargets: targets, knownInstruments: instruments });
  return adjudicate(meta, run, intent, raw);
}

/**
 * Pure, deterministic adjudication.  Every branch below returns SOMETHING —
 * a free action never answers "you can't do that" with nothing attached
 * (SELF_REVIEW P6).
 */
export function adjudicate(
  meta: MetaState, run: RunState, intent: InterpretResponse, raw: string,
): FreeActionResult {
  const rng = new Rng(`${run.seed}:free:${run.clock}:${raw}`);
  const lines: string[] = [];
  const acquisitions: Acquisition[] = [];
  const node = currentNode(run);
  let outcome: Outcome = "informative";
  let timeCost = 30;
  let combatStarted = false;
  let rewriteApplied: string | undefined;
  let beat = "free_action";

  if (run.freeActionsLeft <= 0) {
    return {
      outcome: "informative", intent, timeCost: 0, beat: "free_action_exhausted",
      lines: ["今はそこまで踏み込む余裕がない。（この Run の自由行動は使い切った）"],
      acquisitions: [],
    };
  }
  run.freeActionsLeft -= 1;

  const usesK = (id: KnowledgeId) => intent.usesKnowledge.includes(id) || knows(meta, id);
  const t = intent.target;

  // ---- "I know the king gets poisoned, so I feed the meal to the dog."
  if (intent.verb === "give" && (t === "DOG" || raw.includes("犬")) && knows(meta, "K013")) {
    outcome = "success";
    beat = "poison_averted";
    lines.push("犬は一口で皿を空にし、三歩あるいて倒れた。広間が凍りつく。");
    lines.push("毒殺は起きなかった。あなたが知っていたからだ。");
    const res = applyRewrite(meta, run, "RW02");
    lines.push(...res.lines);
    rewriteApplied = "RW02";
    timeCost = 0;
  }
  // ---- "I call the princess by her real name."
  else if ((intent.verb === "talk" || intent.verb === "deceive" || intent.verb === "other")
    && (t === "PRINCESS" || raw.includes("王女") || raw.includes("リゼ"))
    && usesK("K007")) {
    outcome = "success";
    beat = "princess_named";
    lines.push("その名を口にした瞬間、女の顔から表情が抜け落ちた。");
    const res = applyRewrite(meta, run, "RW03");
    lines.push(...res.lines);
    rewriteApplied = "RW03";
    timeCost = 0;
  }
  // ---- "I attack the rope bridge instead of the enemy."
  else if ((intent.verb === "destroy" || intent.verb === "attack")
    && (t === "BRIDGE" || raw.includes("吊り橋") || raw.includes("橋"))) {
    if (run.combat) {
      outcome = "success"; beat = "bridge_cut";
      const victims = run.combat.enemies.filter((e) => e.hp > 0);
      for (const e of victims.slice(1)) e.hp = 0;
      const first = victims[0];
      if (first) first.hp = Math.max(1, Math.floor(first.hp * 0.4));
      lines.push("縄を断つ。橋がしなり、半数が谷へ消えた。");
      if (rng.chance(0.4)) {
        const dmg = Math.floor(run.player.maxHp * 0.15);
        run.player.hp = Math.max(1, run.player.hp - dmg);
        lines.push(`こちらも足場を失った（HP −${dmg}）`);
      }
    } else {
      outcome = "partial"; beat = "bridge_cut_noncombat";
      lines.push("橋を落とした。この道はもう使えない — 追っ手にとっても同じことだ。");
      run.clock -= 30;
    }
  }
  // ---- "I destroy the grate" (Stormcall opens a shortcut)
  else if (intent.verb === "destroy" && (t === "GRATE" || raw.includes("鉄格子"))) {
    if (run.player.skills.includes("S11")) {
      outcome = "success"; beat = "grate_broken";
      lines.push("雷が鉄を焼き切った。水路の先が開けている。");
      if (!knows(meta, "K008")) acquisitions.push(...grantKnowledge(meta, run, "K008"));
    } else {
      outcome = "informative"; beat = "grate_failed";
      lines.push("びくともしない。錆びてはいるが、鉄は鉄だ。");
      lines.push("（雷なら焼き切れるかもしれない）");
    }
  }
  // ---- Poisoning a cup at a social scene
  else if (intent.verb === "use" && intent.instrument === "I_POISONVIAL" && node?.kind === "social") {
    const silent = run.activeSynergies.includes("Y06");
    run.player.items.splice(run.player.items.indexOf("I_POISONVIAL"), 1);
    if (silent) {
      outcome = "success"; beat = "silent_poison";
      lines.push("［毒杯］誰も、あなたの手元を見ていなかった。");
      run.npcTrust[node.npcId ?? "N01"] = -3;
    } else {
      outcome = "partial"; beat = "poison_seen";
      run.suspicion += 3;
      lines.push("毒は入った。だが見ていた者がいる（Suspicion +3）。");
    }
  }
  // ---- Naming a lie you shouldn't know about
  else if (intent.verb === "deceive" || intent.verb === "persuade") {
    const npcId = node?.npcId ?? (t && NPC_BY_ID.has(t) ? t : null);
    if (npcId && intent.usesKnowledge.length > 0) {
      outcome = "success"; beat = "knowledge_pressed";
      run.suspicion += 2;
      run.npcTrust[npcId] = (run.npcTrust[npcId] ?? 0) - 1;
      lines.push("相手の言葉が止まった。知っているはずのないことを、あなたは知っている。");
      const unknown = KNOWLEDGE.filter((k) => !meta.knowledge[k.id] && !k.synthesizedFrom && k.relatedNPCs.includes(npcId));
      if (unknown.length > 0) acquisitions.push(...grantKnowledge(meta, run, rng.pick(unknown).id, { reliability: "uncertain" }));
      else lines.push("（引き出せるものはもう残っていない）");
    } else if (npcId) {
      outcome = "partial"; beat = "persuade_weak";
      const bonus = run.player.skills.includes("S04") ? 0.3 : 0;
      if (rng.chance(0.35 + bonus)) {
        const g = rng.int(20, 50); run.player.gold += g;
        lines.push(`話はついた（Gold +${g}）。`);
      } else {
        lines.push("取り合ってもらえなかった。根拠が足りない。");
        lines.push("（何か「知っていること」をぶつければ違ったかもしれない）");
      }
    } else {
      outcome = "informative"; beat = "no_listener";
      lines.push("話しかける相手がいない。");
    }
  }
  // ---- Starting a fight out of a scene
  else if (intent.verb === "attack" && !run.combat) {
    outcome = "partial"; beat = "provoked_fight";
    const enemies = node?.region === "castle" ? ["E_KNIGHT", "E_KNIGHT"] : ["E_BANDIT"];
    run.combat = startCombat({ meta, run, rng }, { enemyIds: enemies });
    combatStarted = true;
    run.suspicion += 2;
    lines.push("先に手を出した。引き返せない。");
  }
  else if (intent.verb === "steal") {
    const ok = rng.chance(run.player.skills.includes("S10") ? 0.75 : 0.4);
    if (ok) {
      outcome = "success"; beat = "theft";
      const item = rng.pick(ITEMS.filter((i) => i.price > 0));
      run.player.items.push(item.id);
      lines.push(`${item.jp} を抜き取った。`);
    } else {
      outcome = "partial"; beat = "theft_failed";
      run.suspicion += 2;
      lines.push("指先が触れた瞬間に気づかれた（Suspicion +2）。");
    }
  }
  else if (intent.verb === "hide") {
    outcome = "success"; beat = "hidden";
    run.player.flags["hidden"] = 1;
    lines.push("身を隠した。次の戦闘は奇襲から始まる。");
  }
  // ---- observe / fallback: ALWAYS give information back
  else {
    outcome = "informative"; beat = "observation";
    const observations = buildObservations(meta, run);
    lines.push(rng.pick(observations));
    if (node?.knowledgeId && !meta.knowledge[node.knowledgeId] && rng.chance(0.35)) {
      acquisitions.push(...grantKnowledge(meta, run, node.knowledgeId, { reliability: "rumor" }));
      lines.push("（噂として書き留めた）");
    }
  }

  run.clock += timeCost;
  run.log.push({ clock: run.clock, text: `自由行動: ${raw}`, kind: "info" });
  for (const l of lines) run.log.push({ clock: run.clock, text: l, kind: "info" });
  if (run.player.hp <= 0) onDeath(meta, run, "無茶が過ぎた");

  return { outcome, intent, lines, acquisitions, combatStarted, rewriteApplied, timeCost, beat };
}

/** Failure still teaches: observations point at knowledge the player lacks. */
function buildObservations(meta: MetaState, run: RunState): string[] {
  const out: string[] = [];
  const node = currentNode(run);
  if (!knows(meta, "K013") && node?.region === "castle") {
    out.push("厨房の棚に、王の卓にだけ使われる小瓶がある。犬はその皿に近づかない。");
  }
  if (!knows(meta, "K004")) out.push("壁の燭台が全て外されている。この城の誰かは、火を置きたがらない。");
  if (!knows(meta, "K012") && node?.region === "church") out.push("床石の一枚だけ、擦り減り方が違う。");
  if (!knows(meta, "K008") && node?.region === "sewer") out.push("北の格子の向こうから、桶を引き上げる音がする。");
  if (meta.distortion >= 6) out.push("同じ場所のはずなのに、柱の数が昨日と違う気がする。");
  out.push("特に何も起きなかった。だが、見ていなければ気づかなかったことがある。");
  out.push("誰も見ていない。それ自体が、少し不自然だ。");
  return out;
}
