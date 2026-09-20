import { Game, type View } from "../../src/index.js";

/**
 * A scripted delver used to verify the 3-run experience without a human.
 * It explores, fights, takes stairs, and prefers Knowledge when it is cheap —
 * deliberately simple, because if a dumb bot can feel the loop, a person will.
 */
export type Policy = "greedy-knowledge" | "use-knowledge" | "rewrite";

export interface SimLog { lines: string[]; }

type Dungeon = NonNullable<View["dungeon"]>;

const glyphIsInteresting = (g: string): boolean => "!▒◇Ψ≡$@".includes(g);

/**
 * Navigation works off exactly what the player can see — the rendered rows —
 * so if the bot cannot reach something, neither can a person looking at the
 * same screen.  Distances are real BFS distances, not Manhattan guesses,
 * which is what stops it ping-ponging between two far-apart targets.
 */
function passable(d: Dungeon, x: number, y: number): boolean {
  const ch = d.rows[y]?.[x];
  return ch === "." || ch === "+" || ch === ">" || ch === "<";
}

interface Reach { dist: Int32Array; }

function floodFrom(d: Dungeon, sx: number, sy: number): Reach {
  const dist = new Int32Array(d.w * d.h).fill(-1);
  const q: number[] = [sy * d.w + sx];
  dist[q[0]!] = 0;
  for (let head = 0; head < q.length; head++) {
    const cur = q[head]!;
    const cx = cur % d.w, cy = Math.floor(cur / d.w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!passable(d, nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!passable(d, cx + dx, cy) || !passable(d, cx, cy + dy))) continue;
        const ni = ny * d.w + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[cur]! + 1;
        q.push(ni);
      }
    }
  }
  return { dist };
}

const reachable = (r: Reach, d: Dungeon, t: { x: number; y: number }): number =>
  r.dist[t.y * d.w + t.x]!;

/** Nearest tile that borders something still unknown. */
function frontier(d: Dungeon, r: Reach): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 1; y < d.h - 1; y++) {
    for (let x = 1; x < d.w - 1; x++) {
      if (!passable(d, x, y)) continue;
      const dd = reachable(r, d, { x, y });
      if (dd <= 0 || dd >= bestD) continue;
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
        ([dx, dy]) => d.rows[y + dy!]?.[x + dx!] === " ",
      );
      if (open) { bestD = dd; best = { x, y }; }
    }
  }
  return best;
}

function findStairs(d: Dungeon): { x: number; y: number } | null {
  const e = d.entities.find((x) => ">≫Ω".includes(x.glyph));
  if (e) return { x: e.x, y: e.y };
  for (let y = 0; y < d.h; y++) {
    const x = d.rows[y]!.indexOf(">");
    if (x >= 0) return { x, y };
  }
  return null;
}

/**
 * Each floor gets a share of the remaining minutes.  When it is spent you take
 * the stairs whether or not you saw everything — which is the decision the
 * whole clock system exists to force.
 */
function pickDestinations(d: Dungeon, v: View, policy: Policy, skip: Set<string>): { x: number; y: number }[] {
  const run = v.run!;
  const hpPct = run.hp / run.maxHp;
  const minutesLeft = run.deadline - run.clockMinutes;
  const floorsLeft = Math.max(1, d.maxDepth - d.depth + 1);
  const budget = minutesLeft / floorsLeft;
  const rushing = minutesLeft < 120 || budget < 60 || d.exploredPct > (policy === "rewrite" ? 50 : 72);

  const r = floodFrom(d, d.player.x, d.player.y);
  const ok = (t: { x: number; y: number }): boolean => reachable(r, d, t) > 0;
  const near = (t: { x: number; y: number }): number => reachable(r, d, t);

  const stairs = findStairs(d);
  const loot = d.entities
    .filter((e) => e.kind !== "enemy" && "!▒◇Ψ≡$@".includes(e.glyph))
    .filter((e) => !skip.has(e.uid) && ok(e))
    .filter((e) => {
      if (e.glyph === "▒" && hpPct < 0.5) return false;
      if (e.glyph === "≡" && hpPct > 0.8) return false;
      return true;
    })
    .sort((a, b) => near(a) - near(b));
  const enemies = d.entities
    .filter((e) => e.kind === "enemy" && ok(e))
    .sort((a, b) => near(a) - near(b));

  const out: { x: number; y: number }[] = [];
  const add = (t?: { x: number; y: number } | null): void => {
    if (!t || !ok(t)) return;
    if (out.some((o) => o.x === t.x && o.y === t.y)) return;
    out.push({ x: t.x, y: t.y });
  };

  const fire = loot.find((e) => e.glyph === "≡");
  if (fire && hpPct < 0.6) add(fire);
  const ashDoor = loot.find((e) => e.glyph === "▒");
  if (ashDoor && hpPct > 0.6) add(ashDoor);
  if (!rushing) {
    if (loot[0] && near(loot[0]) <= 24) add(loot[0]);
    if (hpPct > 0.45 && enemies[0] && near(enemies[0]) <= 9) add(enemies[0]);
    add(frontier(d, r));
  }
  add(stairs);
  add(loot[0]);
  add(frontier(d, r));
  if (hpPct > 0.5) add(enemies[0]);
  return out;
}

function pickSceneChoice(v: View, policy: Policy): string {
  const cs = (v.scene?.choices ?? []).filter((c) => !c.locked);
  if (cs.length === 0) return "LEAVE";
  if (policy === "rewrite") {
    const rw = cs.find((c) => c.actionId.startsWith("REWRITE:"));
    if (rw) return rw.actionId;
  }
  const hpPct = v.run ? v.run.hp / v.run.maxHp : 1;
  const buyHeal = cs.find((c) => c.actionId.startsWith("BUY:I_ELIXIR") || c.actionId.startsWith("BUY:I_BANDAGE"));
  if (buyHeal && (v.run?.items.filter((i) => i.kind === "consumable").length ?? 0) < 3) return buyHeal.actionId;

  const prefix = (p: string): string | undefined => cs.find((c) => c.actionId.startsWith(p))?.actionId;
  const order = ["LORE:", "CHEST:", "PRESS_PRIEST:", "LIE_EYE:", "EMPATH:", "NECRO:", "TALK:", "PASS:"];
  if (hpPct > 0.55) order.unshift("ASH:");
  if (hpPct < 0.7) order.unshift("REST_HEAL:");
  for (const p of order) { const hit = prefix(p); if (hit) return hit; }
  const descend = cs.find((c) => c.actionId.startsWith("DESCEND:"));
  if (descend) return descend.actionId;
  const leave = cs.find((c) => c.actionId === "LEAVE" || c.actionId === "VILLAGE_LEAVE");
  return leave?.actionId ?? cs[cs.length - 1]!.actionId;
}

async function fightUntilDone(g: Game, log: SimLog): Promise<View> {
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
      log.lines.push(`      ▸ 特殊行動: ${special.label} [${special.source}]`);
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
  if (v.screen === "combat") { log.lines.push("      （膠着。撤退）"); v = g.giveUp(); }
  else if (v.run) log.lines.push(`      戦闘終了 — HP ${v.run.hp}/${v.run.maxHp}`);
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
  let lastDepth = 0;
  let stuck = 0;
  const declined = new Set<string>();
  let lastDest: { x: number; y: number } | null = null;
  let actions = 0;

  while (v.screen !== "report" && guard++ < 1200) {
    actions++;
    switch (v.screen) {
      case "scene": {
        log.lines.push(`  [${v.run!.clock}] ${v.scene!.title}`);
        if (v.scene!.dialogue) log.lines.push(`    ${v.scene!.dialogue}`);
        const choice = pickSceneChoice(v, policy);
        // the scene's id IS the entity we bumped, which may not be the tile we
        // aimed at — record the real one so we never talk to it twice
        if (v.scene) declined.add(v.scene.nodeId);
        if (lastDest) declined.add(`${lastDest.x},${lastDest.y}`);
        v = await g.choose(choice);
        for (const e of v.events) {
          if (e.type === "knowledge" && e.card) logCard(log, e.card);
          else if (e.type === "rewrite") log.lines.push(`    ★ REWRITE 実行: ${e.text}`);
          else if (e.text) log.lines.push(`    ${e.text}`);
        }
        break;
      }
      case "dungeon": {
        const d = v.dungeon!;
        if (d.depth !== lastDepth) {
          lastDepth = d.depth;
          declined.clear();
          log.lines.push(`  [${v.run!.clock}] ▼ ${d.title}  (${d.w}×${d.h})`);
        }
        // standing on something usable? use it (this is how stairs are taken)
        const under = d.adjacent.find((a) => a.dx === 0 && a.dy === 0);
        if (under && under.kind !== "enemy" && !declined.has(under.uid)) {
          declined.add(under.uid);
          v = await g.interact();
          for (const e of v.events) if (e.text) log.lines.push(`    ${e.text}`);
          if (v.screen !== "dungeon") break;
        }

        const before = `${d.player.x},${d.player.y}`;
        let moved = false;
        for (const dest of pickDestinations(d, v, policy, declined)) {
          lastDest = dest;
          v = await g.travel(dest.x, dest.y);
          for (const e of v.events) {
            if (e.type === "knowledge" && e.card) logCard(log, e.card);
            else if (e.type === "rewrite") log.lines.push(`    ★ REWRITE 実行: ${e.text}`);
            else if (e.text && !e.text.startsWith("灰が肌")) log.lines.push(`    ${e.text}`);
          }
          if (v.screen !== "dungeon") { moved = true; break; }
          if (`${v.dungeon!.player.x},${v.dungeon!.player.y}` !== before) { moved = true; break; }
          declined.add(`${dest.x},${dest.y}`);
        }
        if (!moved) {
          if (++stuck > 4) {
            log.lines.push("    （行き場がない。ここで力尽きた）");
            v = g.giveUp();
          } else {
            v = await g.rest();
          }
        } else stuck = 0;
        if (v.screen === "combat") v = await fightUntilDone(g, log);
        break;
      }
      case "combat":
        v = await fightUntilDone(g, log);
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
  if (v.screen !== "report") v = g.giveUp();
  log.lines.push(`  （このRUNのプレイヤー操作回数: ${actions}）`);
  return v;
}

export function logReport(v: View, log: SimLog): void {
  const r = v.report!;
  log.lines.push("");
  log.lines.push("  ┌──────────────────  RUN REPORT  ──────────────────┐");
  log.lines.push(`  │ ${r.outcome === "dead" ? "DEAD" : "CLEARED"} — ${r.deathCause ?? ""}`);
  log.lines.push(`  │ ${r.epitaph}`);
  log.lines.push(`  │ 到達深度         ${r.deepestFloor}`);
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
