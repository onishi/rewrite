import { Game, type View } from "../../src/index.js";

/**
 * A scripted player used to verify the 3-run experience without a human.
 * Deliberately simple: if a dumb bot can feel the loop, a person will too.
 */
export type Policy = "greedy-knowledge" | "use-knowledge" | "rewrite";

export interface SimLog { lines: string[]; }

function pickNode(v: View, policy: Policy): string {
  const opts = v.options ?? [];
  if (opts.length === 0) return "";
  const score = (n: (typeof opts)[number]): number => {
    let s = 0;
    if (n.revealedByKnowledge) s += 6;
    if (n.convertedBy) s += 5;
    if (n.tags.includes("shortcut")) s += 7;
    if (n.knowledgeId) s += 5;
    if (n.kind === "discovery") s += 4;
    if (n.kind === "ashdoor") s += policy === "greedy-knowledge" ? 5 : 2;
    if (n.kind === "social") s += 3;
    if (n.kind === "shop") s += 2;
    const hurt = v.run ? v.run.hp / v.run.maxHp : 1;
    const preBoss = v.run ? v.run.step + 2 >= v.run.totalSteps : false;
    if (n.kind === "rest") s += hurt < 0.5 ? 6 : 0;
    if (n.kind === "rest" && preBoss && hurt < 0.85) s += 10;
    // Run 3 plays to win: fights are the power curve, so take them while healthy.
    const strong = policy === "rewrite";
    if (n.kind === "elite") s += strong ? 6 : 1;
    if (n.kind === "combat") s += strong ? 6 : 2;
    if (strong && n.kind === "discovery") s -= 2;
    const hpPct = v.run ? v.run.hp / v.run.maxHp : 1;
    if (hpPct < 0.35) s -= n.danger * 2;
    return s;
  };
  return opts.slice().sort((a, b) => score(b) - score(a))[0]!.id;
}

function pickSceneChoice(v: View, policy: Policy): string {
  const cs = (v.scene?.choices ?? []).filter((c) => !c.locked);
  if (cs.length === 0) return "LEAVE";
  if (policy === "rewrite") {
    const rw = cs.find((c) => c.actionId.startsWith("REWRITE:"));
    if (rw) return rw.actionId;
  }
  const buyHeal = cs.find((c) => c.actionId.startsWith("BUY:I_ELIXIR") || c.actionId.startsWith("BUY:I_BANDAGE"));
  if (buyHeal && (v.run?.items.filter((i) => i.kind === "consumable").length ?? 0) < 3) return buyHeal.actionId;
  const buyPunch = cs.find((c) => c.actionId.startsWith("BUY:I_TORCH") || c.actionId.startsWith("BUY:I_STORMVIAL"));
  if (buyPunch) return buyPunch.actionId;
  const order = ["DISC_TAKE", "ASH_ENTER", "PRESS_PRIEST", "LIE_EYE", "EMPATH", "NECRO", "TALK",
    "SHRINE_HP", "REST_HEAL", "VILLAGE_LEAVE", "LEAVE"];
  for (const id of order) {
    const hit = cs.find((c) => c.actionId === id);
    if (hit) return hit.actionId;
  }
  return cs[0]!.actionId;
}

async function fightUntilDone(g: Game, log: SimLog, policy: Policy): Promise<View> {
  let v = g.view();
  let guard = 0;
  while (v.screen === "combat" && guard++ < 80) {
    const c = v.combat!;
    const run = v.run!;
    const target = c.enemies[0];
    if (!target) break;

    const special = c.specials.find((s) => s.reliability !== "invalidated");
    const usable = run.skills
      .filter((s) => s.active && s.focusCost <= run.focus && s.id !== "S04" && s.id !== "S05")
      .sort((a, b) => b.focusCost - a.focusCost);
    const offensiveItem = run.items.find((i) => i.id === "I_STORMVIAL" || i.id === "I_OILFLASK");
    const hpPct = run.hp / run.maxHp;

    if (special && (c.isBoss || special.id.includes("NEGOTIATE") || special.id === "SA_TALK")) {
      log.lines.push(`    ▸ 特殊行動: ${special.label} [${special.source}]`);
      v = await g.combat({ kind: "special", actionId: special.id, targetUid: target.uid });
    } else if (hpPct < 0.25 && run.items.some((i) => i.id === "I_BANDAGE" || i.id === "I_ELIXIR")) {
      const heal = run.items.find((i) => i.id === "I_ELIXIR") ?? run.items.find((i) => i.id === "I_BANDAGE")!;
      v = await g.combat({ kind: "item", itemId: heal.id });
    } else if (c.isBoss && offensiveItem && target.hp > 40) {
      v = await g.combat({ kind: "item", itemId: offensiveItem.id, targetUid: target.uid });
    } else if (hpPct < 0.2 && run.guard === 0 && c.turn % 2 === 0) {
      v = await g.combat({ kind: "defend" });
    } else if (usable.length > 0) {
      v = await g.combat({ kind: "skill", skillId: usable[0]!.id, targetUid: target.uid });
    } else {
      v = await g.combat({ kind: "attack", targetUid: target.uid });
    }
    for (const e of v.events) if (e.type === "knowledge" && e.card) logCard(log, e.card);
  }
  if (v.screen === "combat") { log.lines.push("    （膠着。撤退）"); v = g.giveUp(); }
  else if (v.run) log.lines.push(`    戦闘終了 — HP ${v.run.hp}/${v.run.maxHp}`);
  return v;
}

function logCard(log: SimLog, card: { title: string; reliability: string; synthesized: boolean; effects: string[]; truths: string[] }): void {
  log.lines.push("");
  log.lines.push("    ╔══════════════════════════════════════════════════╗");
  log.lines.push(`    ║  KNOWLEDGE ${card.synthesized ? "SYNTHESIZED" : "ACQUIRED"}`);
  log.lines.push(`    ║  ${card.title}  [${card.reliability}]`);
  for (const e of card.effects) log.lines.push(`    ║    ▸ ${e}`);
  for (const t of card.truths) log.lines.push(`    ║    ◆ ${t}`);
  log.lines.push("    ╚══════════════════════════════════════════════════╝");
  log.lines.push("");
}

export async function playRun(g: Game, seed: string, policy: Policy, log: SimLog): Promise<View> {
  let v = await g.startRun(seed);
  log.lines.push(`\n════════ RUN ${v.run!.runNumber}  (policy: ${policy}) ════════`);
  log.lines.push(`開始スキル: ${v.run!.skills.map((s) => s.jp).join(" / ")}`);

  let guard = 0;
  while (v.screen !== "report" && guard++ < 300) {
    switch (v.screen) {
      case "scene": {
        log.lines.push(`  [${v.run!.clock}] ${v.scene!.title}`);
        if (v.scene!.dialogue) log.lines.push(`    ${v.scene!.dialogue}`);
        const choice = pickSceneChoice(v, policy);
        v = await g.choose(choice);
        for (const e of v.events) {
          if (e.type === "knowledge" && e.card) logCard(log, e.card);
          else if (e.type === "rewrite") log.lines.push(`    ★ REWRITE 実行: ${e.text}`);
          else if (e.text) log.lines.push(`    ${e.text}`);
        }
        break;
      }
      case "map": {
        const id = pickNode(v, policy);
        if (!id) { v = g.giveUp(); break; }
        const node = (v.options ?? []).find((n) => n.id === id)!;
        log.lines.push(`  [${v.run!.clock}] → ${node.name} (${node.kind}, 危険度${node.danger}, ${node.timeCost / 60}h)` +
          (node.revealedByKnowledge ? `  ※Knowledge により出現` : "") +
          (node.convertedBy ? `  ※Knowledge により戦闘回避` : ""));
        v = await g.enter(id);
        for (const e of v.events) {
          if (e.type === "knowledge" && e.card) logCard(log, e.card);
          else if (e.text) log.lines.push(`    ${e.text}`);
        }
        if (v.screen === "combat") v = await fightUntilDone(g, log, policy);
        break;
      }
      case "combat":
        v = await fightUntilDone(g, log, policy);
        break;
      case "reward": {
        const skills = v.reward?.skills ?? [];
        const best = skills.find((s) => s.synergy) ?? skills[0];
        if (best) {
          log.lines.push(`    報酬3択: ${skills.map((s) => s.jp + (s.synergy ? ` ⚡${s.synergy}` : "")).join(" / ")}`);
          log.lines.push(`    → ${best.jp} を選択`);
        }
        v = await g.reward(best?.id ?? null);
        for (const e of v.events) if (e.type === "synergy") log.lines.push(`    ${e.text}`);
        break;
      }
      default:
        v = g.giveUp();
    }
    if (v.run && v.run.hp <= 0 && v.screen !== "report") v = g.giveUp();
  }
  return v;
}

export function logReport(v: View, log: SimLog): void {
  const r = v.report!;
  log.lines.push("");
  log.lines.push("  ┌──────────────────  RUN REPORT  ──────────────────┐");
  log.lines.push(`  │ ${r.outcome === "dead" ? "DEAD" : "CLEARED"} — ${r.deathCause ?? ""}`);
  log.lines.push(`  │ ${r.epitaph}`);
  log.lines.push("  │");
  log.lines.push("  │ このRUNで世界について分かったこと");
  if (r.newKnowledge.length === 0) log.lines.push("  │   （なし）");
  for (const k of r.newKnowledge) {
    log.lines.push(`  │   ▸ ${k.title} ${k.synthesized ? "[合成]" : "[NEW]"}`);
    for (const e of k.effects) log.lines.push(`  │       ${e}`);
  }
  log.lines.push(`  │ 初めて見た場所   ${r.firstSeen.join(" / ") || "—"}`);
  log.lines.push(`  │ 倒したBoss       ${r.bossesDefeated.join(" / ") || "—"}`);
  log.lines.push(`  │ 最大シナジー     ${r.bestSynergy ?? "—"}`);
  log.lines.push(`  │ 書き換えた歴史   ${r.historyRewritten.join(" / ") || "なし"}`);
  log.lines.push("  │");
  log.lines.push("  │ 次のRUNで新しくできること");
  for (const u of r.nextRunUnlocks) log.lines.push(`  │   ▸ ${u}`);
  log.lines.push("  │");
  log.lines.push(`  │   [ ${r.rewriteButtonLabel} ]`);
  log.lines.push("  └──────────────────────────────────────────────────┘");
}
