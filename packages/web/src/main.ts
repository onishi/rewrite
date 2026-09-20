import { Game } from "../../core/src/engine/game.js";
import type { View, GameEvent, KnowledgeCard } from "../../core/src/engine/game.js";
import type { MetaState, MapNode } from "../../core/src/types.js";
import { newMeta } from "../../core/src/engine/run.js";
import { detectProvider } from "./net.js";

/**
 * UI layer.  It reads the View the engine hands it and sends commands back.
 * It contains no rules — every number on screen was computed by the engine.
 */

const app = document.getElementById("app")!;
const overlay = document.getElementById("overlay")!;
const SAVE_KEY = "rewrite.meta.v1";

let game: Game;
let view: View;
let busy = false;

// ------------------------------------------------------------------ persistence
function loadMeta(): MetaState | undefined {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as MetaState;
    return { ...newMeta(), ...parsed };
  } catch { return undefined; }
}
function saveMeta(): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.state.meta)); } catch { /* private mode */ }
}

// ------------------------------------------------------------------ helpers
const h = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function button(cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.addEventListener("click", () => { if (!busy) void onClick(); });
  return b;
}

/** Overlay controls ignore `busy`: act() holds that flag while awaiting them. */
function modalButton(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", () => onClick());
  return b;
}

async function act(fn: () => Promise<View>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    view = await fn();
    saveMeta();
    await showAcquisitions(view.events);
    render();
  } finally { busy = false; }
}

const RELIABILITY_JP: Record<string, string> = {
  confirmed: "確定", uncertain: "不確か", rumor: "噂", invalidated: "無効",
};

// ------------------------------------------------------------------ knowledge card
function showAcquisitions(events: GameEvent[]): Promise<void> {
  const cards = events.filter((e) => e.type === "knowledge" && e.card).map((e) => e.card!);
  if (cards.length === 0) return Promise.resolve();
  return new Promise((done) => {
    let i = 0;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Enter" || ev.key === " " || ev.key === "Escape") { ev.preventDefault(); next(); }
    };
    const next = (): void => {
      if (i >= cards.length) {
        document.removeEventListener("keydown", onKey);
        overlay.classList.add("hidden");
        overlay.replaceChildren();
        done();
        return;
      }
      overlay.replaceChildren(knowledgeCard(cards[i]!, next));
      overlay.classList.remove("hidden");
      (overlay.querySelector("button") as HTMLButtonElement | null)?.focus();
      i++;
    };
    document.addEventListener("keydown", onKey);
    next();
  });
}

/**
 * The single most important screen in the game: Knowledge is presented as a
 * list of NEW RULES, not as a paragraph of story (SELF_REVIEW Q4).
 */
function knowledgeCard(card: KnowledgeCard, onClose: () => void): HTMLElement {
  const box = h("div", "kcard");
  const cap = card.upgradedFrom
    ? "KNOWLEDGE CONFIRMED"
    : card.synthesized ? "KNOWLEDGE SYNTHESIZED" : "KNOWLEDGE ACQUIRED";
  box.append(h("div", "cap", cap));
  box.append(h("h3", undefined, `${card.id}  ${card.title}`));
  box.append(h("div", "desc", card.description));
  const rel = h("div", `rel rel-${card.reliability}`,
    `信頼度: ${RELIABILITY_JP[card.reliability] ?? card.reliability}` +
    (card.upgradedFrom ? `（${RELIABILITY_JP[card.upgradedFrom]} から昇格）` : ""));
  box.append(rel);

  const ul = h("ul");
  for (const e of card.effects) ul.append(h("li", undefined, e));
  for (const t of card.truths) ul.append(h("li", "truth", t));
  box.append(ul);

  const b = modalButton("choice", card.synthesized ? "2つの知識が結びついた" : "続ける", onClose);
  b.style.marginTop = "16px";
  box.append(b);
  return box;
}

// ------------------------------------------------------------------ screens
function render(): void {
  app.className = "";
  app.replaceChildren();

  if (view.screen === "title") { app.append(renderTitle()); return; }
  if (view.screen === "report") { app.append(renderReport()); return; }

  app.append(renderTopbar());
  const layout = h("div", "layout");
  const main = h("div");
  switch (view.screen) {
    case "scene": main.append(renderScene()); break;
    case "map": main.append(renderMap()); break;
    case "combat": main.append(renderCombat()); break;
    case "reward": main.append(renderReward()); break;
  }
  main.append(renderEvents());
  layout.append(main, renderSide());
  app.append(layout);
}

function renderTitle(): HTMLElement {
  const wrap = h("div");
  wrap.append(h("h1", "brand", "REWRITE"));
  wrap.append(h("div", "tagline",
    "死ぬと時間は巻き戻り、レベルも装備も失われる。残るのは、知ってしまったことだけだ。"));

  const p = h("div", "panel");
  const m = view.meta;
  p.append(h("h2", "section", `RUN ${m.totalRuns + 1}`));
  if (m.totalRuns > 0) {
    p.append(h("div", "muted",
      `Knowledge ${m.knowledge.length} 件 / 世界の真実 ${m.truths.filter((t) => t.revealed).length}/10 / ` +
      `REWRITE 実行 ${m.executedRewrites.length} 回` +
      (m.distortionVisible ? ` / Distortion ${m.distortion}` : "")));
  } else {
    p.append(h("div", "muted", "はじめまして。まずは普通のローグライクとして遊んでください。"));
  }
  const start = button("big", () => act(() => game.startRun()));
  start.textContent = m.totalRuns === 0 ? "▶ 始める" : "▶ REWRITE — 時間を巻き戻す";
  start.style.marginTop = "16px";
  p.append(start);

  const row = h("div", "row");
  row.style.marginTop = "10px";
  const codex = button("choice", () => openCodex());
  codex.textContent = "Knowledge 一覧を見る";
  row.append(codex);
  if (m.totalRuns > 0) {
    const reset = button("choice", () => {
      if (!confirm("すべての Knowledge を消去して最初からやり直しますか？")) return;
      localStorage.removeItem(SAVE_KEY);
      game = new Game(game.provider, newMeta());
      view = game.view();
      render();
    });
    reset.textContent = "すべて消去";
    row.append(reset);
  }
  p.append(row);
  wrap.append(p);
  return wrap;
}

function renderTopbar(): HTMLElement {
  const bar = h("div", "topbar");
  const r = view.run!;
  const add = (k: string, v: string): void => {
    const s = h("span");
    s.append(h("span", "k", k), h("span", "v", v));
    bar.append(s);
  };
  add("RUN", String(r.runNumber));
  add("時刻", r.clock);

  const clockBar = h("div", "bar clock");
  const pct = Math.min(100, ((r.clockMinutes - 360) / (r.deadline - 360)) * 100);
  const ci = h("i"); ci.style.width = `${pct}%`; clockBar.append(ci);
  bar.append(clockBar);

  add("HP", `${r.hp}/${r.maxHp}${r.guard > 0 ? ` (+${r.guard})` : ""}`);
  const hpBar = h("div", "bar hp");
  const hi = h("i"); hi.style.width = `${(r.hp / r.maxHp) * 100}%`; hpBar.append(hi);
  bar.append(hpBar);

  add("Focus", `${r.focus}/${r.maxFocus}`);
  add("Lv", String(r.level));
  add("Gold", String(r.gold));
  if (view.meta.distortionVisible) add("Distortion", String(view.meta.distortion));

  const badge = h("span", `badge${view.provider === "mock" ? "" : " ai"}`,
    view.provider === "mock" ? "MOCK" : "AI");
  badge.title = view.provider === "mock"
    ? "LLM なしで動作中。ゲームの全機能が利用できます。"
    : "物語文のみ生成AIが担当。数値はすべてゲームエンジンが決定しています。";
  bar.append(badge);
  return bar;
}

function renderScene(): HTMLElement {
  const p = h("div", "panel");
  const s = view.scene!;
  p.append(h("h2", "section", s.title));
  p.append(h("div", "narr", s.narrative));
  if (s.dialogue) {
    const d = h("div", "dialogue");
    if (s.speaker) d.append(h("div", "speaker", s.speaker));
    d.append(h("div", undefined, s.dialogue));
    p.append(d);
  }

  const choices = h("div", "choices");
  for (const c of s.choices) {
    const isRw = c.actionId.startsWith("REWRITE:");
    const b = button(`choice${isRw ? " rewrite" : ""}`, () => act(() => game.choose(c.actionId)));
    b.disabled = !!c.locked;
    b.append(h("span", undefined, c.label));
    if (c.dangerHint) {
      const t = h("span", `tag ${c.dangerHint === "safe" ? "good" : "danger"}`,
        c.dangerHint === "safe" ? "安全" : c.dangerHint === "risky" ? "危険" : "致命的");
      t.style.marginLeft = "8px";
      b.append(t);
    }
    if (c.locked && c.lockReason) b.append(h("span", "tag", c.lockReason));
    if (isRw) {
      const rw = s.rewrites?.find((r) => `REWRITE:${r.id}` === c.actionId);
      if (rw) {
        const sub = h("div", "muted");
        sub.style.fontSize = "12px";
        sub.style.marginTop = "5px";
        sub.textContent = `${rw.utterance}  →  ${rw.preview.join(" / ")}`;
        b.append(sub);
      }
    }
    choices.append(b);
  }
  p.append(choices);
  if (s.foreshadowing) p.append(h("div", "fore", s.foreshadowing));
  if (s.allowFreeAction) p.append(renderFreeAction());
  return p;
}

function renderFreeAction(): HTMLElement {
  const d = document.createElement("details");
  d.className = "free";
  const sum = document.createElement("summary");
  sum.textContent = `［ 自由に行動する ］  残り ${view.run!.freeActionsLeft} 回`;
  d.append(sum);
  const inner = h("div", "inner");
  const input = document.createElement("input");
  input.placeholder = "例: 毒殺されることを知っているので、王の料理を犬に食べさせる";
  input.disabled = view.run!.freeActionsLeft <= 0;
  const go = button("choice", () => {
    const t = input.value.trim();
    if (t) void act(() => game.free(t));
  });
  go.textContent = "実行";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const t = input.value.trim(); if (t) void act(() => game.free(t)); }
  });
  inner.append(input, go);
  d.append(inner);
  return d;
}

function renderMap(): HTMLElement {
  const p = h("div", "panel");
  p.append(h("h2", "section", "どこへ向かう"));
  const grid = h("div", "nodes");
  for (const n of (view.options ?? []) as MapNode[]) {
    const b = button("node", () => act(() => game.enter(n.id)));
    b.append(h("div", "name", n.name));
    const meta = h("div", "meta");
    meta.append(h("span", undefined, KIND_JP[n.kind] ?? n.kind));
    meta.append(h("span", "skulls", n.danger > 0 ? "◆".repeat(n.danger) : "安全"));
    meta.append(h("span", undefined, `${n.timeCost / 60}h`));
    b.append(meta);
    const hints = h("div", "hints");
    for (const t of n.hints) hints.append(h("span", "tag", t));
    if (n.revealedByKnowledge) hints.append(h("span", "tag know", "Knowledge により出現"));
    if (n.convertedBy) hints.append(h("span", "tag good", "Knowledge により戦闘回避"));
    b.append(hints);
    grid.append(b);
  }
  p.append(grid);
  return p;
}

const KIND_JP: Record<string, string> = {
  combat: "戦闘", elite: "強敵", social: "会話", discovery: "発見", shop: "店",
  shrine: "祭壇", rest: "休息", ashdoor: "灰の扉", boss: "対決", hub: "村",
};

function renderCombat(): HTMLElement {
  const p = h("div", "panel");
  const c = view.combat!;
  const r = view.run!;
  p.append(h("h2", "section", `${c.isBoss ? "BOSS" : "戦闘"} — TURN ${c.turn}`));

  let target = c.enemies[0]?.uid ?? "";
  const list = h("div", "enemies");
  for (const e of c.enemies) {
    const box = h("div", `enemy${e.uid === target ? " sel" : ""}`);
    box.addEventListener("click", () => {
      target = e.uid;
      for (const el of list.children) el.classList.remove("sel");
      box.classList.add("sel");
    });
    const row = h("div", "row");
    row.append(h("span", "nm", e.name));
    const it = h("span", `intent ${e.intent.shown}`,
      `${e.intent.detected ? "⚑ " : ""}${e.intent.label}${e.intent.damage ? ` ${e.intent.damage}` : ""}`);
    row.append(it);
    box.append(row);
    const bar = h("div", "bar hp");
    const i = h("i"); i.style.width = `${(e.hp / e.maxHp) * 100}%`; bar.append(i);
    box.append(bar);
    const info = h("div", "meta");
    info.append(h("span", undefined, `${e.hp}/${e.maxHp}${e.guard > 0 ? ` 🛡${e.guard}` : ""}`));
    for (const s of e.statuses) info.append(h("span", "tag", `${s.kind} ${s.amount}`));
    box.append(info);
    list.append(box);
  }
  p.append(list);

  if (r.statuses.length > 0) {
    const mine = h("div", "hints");
    for (const s of r.statuses) mine.append(h("span", "tag danger", `自分: ${s.kind} ${s.amount}`));
    p.append(mine);
  }

  const actions = h("div", "actions");
  const atk = button("act", () => act(() => game.combat({ kind: "attack", targetUid: target })));
  atk.append(h("span", undefined, "攻撃"), h("span", "sub", `威力 ${10 + r.power} / Focus +1`));
  actions.append(atk);

  for (const s of r.skills.filter((x) => x.active)) {
    const b = button("act", () => act(() => game.combat({ kind: "skill", skillId: s.id, targetUid: target })));
    b.disabled = r.focus < s.focusCost;
    b.append(h("span", undefined, `${s.jp}`), h("span", "sub", `Focus ${s.focusCost} — ${s.desc}`));
    actions.append(b);
  }
  for (const e of r.echoes) {
    const b = button("act special", () => act(() => game.combat({ kind: "skill", skillId: e, targetUid: target })));
    b.append(h("span", undefined, "Echo"), h("span", "sub", "死者から借りた一撃"));
    actions.append(b);
  }
  for (const i of r.items.filter((x) => x.kind === "consumable")) {
    const b = button("act", () => act(() => game.combat({ kind: "item", itemId: i.id, targetUid: target })));
    b.append(h("span", undefined, i.jp), h("span", "sub", `${i.quick ? "即時 — " : ""}${i.desc}`));
    actions.append(b);
  }
  const def = button("act", () => act(() => game.combat({ kind: "defend" })));
  def.append(h("span", undefined, "防御"), h("span", "sub", `Guard +${6 + r.level * 2} / Focus +2`));
  actions.append(def);

  for (const s of c.specials) {
    const b = button("act special", () => act(() => game.combat({ kind: "special", actionId: s.id, targetUid: target })));
    const rel = s.reliability && s.reliability !== "confirmed" ? `（${RELIABILITY_JP[s.reliability]}）` : "";
    b.append(h("span", undefined, `${s.label}${rel}`),
      h("span", "sub", `${s.sourceKind === "knowledge" ? "Knowledge" : s.sourceKind === "synergy" ? "SYNERGY" : ""} ${s.source} — ${s.desc}`));
    actions.append(b);
  }
  const flee = button("act", () => act(() => game.combat({ kind: "flee" })));
  flee.append(h("span", undefined, "逃走"), h("span", "sub", "1時間を失う / 報酬なし"));
  actions.append(flee);
  p.append(actions);

  if (c.log.length > 0) {
    const lg = h("div", "log");
    lg.style.marginTop = "12px";
    for (const l of c.log) lg.append(h("div", undefined, l));
    p.append(lg);
  }
  return p;
}

function renderReward(): HTMLElement {
  const p = h("div", "panel");
  p.append(h("h2", "section", "報酬を1つ選ぶ"));
  const grid = h("div", "reward-cards");
  for (const s of view.reward?.skills ?? []) {
    const b = button(`card${s.synergy ? " syn" : ""}`, () => act(() => game.reward(s.id)));
    if (s.synergy) b.append(h("span", "synbadge", `⚡ SYNERGY: ${s.synergy}`));
    b.append(h("div", "jp", s.jp));
    b.append(h("div", "d", s.desc));
    if (s.worldDesc) b.append(h("div", "w", `戦闘外: ${s.worldDesc}`));
    grid.append(b);
  }
  for (const i of view.reward?.items ?? []) {
    const b = button("card", () => act(() => game.reward(i.id)));
    b.append(h("div", "jp", i.jp), h("div", "d", i.desc));
    grid.append(b);
  }
  p.append(grid);
  const skip = button("choice", () => act(() => game.reward(null)));
  skip.textContent = "何も取らない";
  skip.style.marginTop = "10px";
  p.append(skip);
  return p;
}

function renderEvents(): HTMLElement {
  const wrap = h("div", "events");
  for (const e of view.events) {
    if (e.type === "knowledge") continue;
    if (!e.text) continue;
    wrap.append(h("div", `ev ${e.type}`, e.text));
  }
  return wrap;
}

function renderSide(): HTMLElement {
  const side = h("div", "side");
  const r = view.run!;

  const s1 = h("div", "panel");
  s1.append(h("h2", "section", "ビルド"));
  const sk = h("div", "list");
  for (const s of r.skills) {
    const c = h("div", "chip");
    c.append(h("b", undefined, s.jp));
    c.append(h("span", "t", s.worldDesc ? `戦闘外: ${s.worldDesc}` : s.desc));
    sk.append(c);
  }
  s1.append(sk);
  if (r.synergies.length > 0) {
    s1.append(h("div", "stat", ""));
    const sy = h("div", "list");
    for (const s of r.synergies) {
      const c = h("div", "chip syn");
      c.append(h("b", undefined, `⚡ ${s.jp}`), h("span", "t", s.desc));
      sy.append(c);
    }
    s1.append(sy);
  }
  if (r.items.length > 0) {
    const it = h("div", "list");
    for (const i of r.items) it.append(h("div", "chip", i.jp));
    s1.append(it);
  }
  side.append(s1);

  const s2 = h("div", "panel");
  s2.append(h("h2", "section", `Knowledge ${view.meta.knowledge.length}`));
  const open = button("choice", () => openCodex());
  open.textContent = "一覧を開く";
  s2.append(open);
  for (const n of view.meta.nearSynthesis.slice(0, 2)) {
    s2.append(h("div", "hint", `あと1つで「${n.title}」が繋がる`));
  }
  if (r.worldDeltas.length > 0) {
    s2.append(h("div", "stat", ""));
    for (const d of r.worldDeltas) s2.append(h("div", "chip", `★ ${d}`));
  }
  side.append(s2);

  const s3 = h("div", "panel");
  s3.append(h("h2", "section", "記録"));
  const lg = h("div", "log");
  for (const l of r.log) lg.append(h("div", l.kind, `${l.clock} ${l.text}`));
  s3.append(lg);
  side.append(s3);
  return side;
}

function renderReport(): HTMLElement {
  const wrap = h("div", "panel report");
  const r = view.report!;
  wrap.append(h("h2", undefined, r.outcome === "dead" ? "DEAD" : "CLEARED"));
  wrap.append(h("div", "epitaph", r.epitaph));

  const block = (title: string): HTMLElement => {
    const b = h("div", "block");
    b.append(h("div", "h", title));
    return b;
  };

  const k = block("このRUNで世界について分かったこと");
  if (r.newKnowledge.length === 0) k.append(h("div", "muted", "—"));
  for (const item of r.newKnowledge) {
    const d = h("div", "kitem");
    d.append(h("div", "t", `▸ ${item.title} ${item.synthesized ? "［合成］" : "［NEW］"}`));
    for (const e of item.effects) d.append(h("div", "e", e));
    k.append(d);
  }
  wrap.append(k);

  const facts = block("");
  const line = (label: string, val: string): void => {
    const d = h("div", "row");
    d.append(h("span", "h", label), h("span", undefined, val || "—"));
    facts.append(d);
  };
  line("初めて見た場所", r.firstSeen.join(" / "));
  line("倒したBoss", r.bossesDefeated.join(" / "));
  line("新しく判明した関係", r.relationshipsLearned.join(" / "));
  line("最大シナジー", r.bestSynergy ?? "");
  line("書き換えた歴史", r.historyRewritten.join(" / ") || "なし");
  if (r.endingReached) {
    line("到達したEnding", view.meta.endings.find((e) => e.id === r.endingReached)?.name ?? r.endingReached);
  }
  wrap.append(facts);

  const u = block("次のRUNで新しくできること");
  for (const item of r.nextRunUnlocks) u.append(h("div", "unlock", `▸ ${item}`));
  wrap.append(u);

  const b = button("big", () => act(() => game.startRun()));
  b.textContent = r.rewriteButtonLabel;
  wrap.append(b);

  const back = button("choice", () => { view = { ...game.view(), screen: "title" } as View; render(); });
  back.textContent = "タイトルへ戻る";
  back.style.marginTop = "10px";
  wrap.append(back);
  return wrap;
}

// ------------------------------------------------------------------ codex
function openCodex(): void {
  const box = h("div", "codex");
  const m = view.meta;
  const head = h("div", "panel");
  head.append(h("h2", "section", `Knowledge — ${m.knowledge.length} 件`));
  if (m.knowledge.length === 0) head.append(h("div", "muted", "まだ何も知らない。"));
  for (const n of m.nearSynthesis) {
    head.append(h("div", "hint", `あと1つで「${n.title}」が繋がる — 不足: ${n.missing.join(", ")}`));
  }
  box.append(head);

  for (const k of m.knowledge) {
    const row = h("div", "krow");
    const t = h("div", "t");
    t.append(h("span", undefined, `${k.id}  ${k.title}  `));
    t.append(h("span", `rel rel-${k.reliability}`, RELIABILITY_JP[k.reliability] ?? k.reliability));
    row.append(t);
    for (const e of k.effects) row.append(h("div", "e", `▸ ${e}`));
    box.append(row);
  }

  const truths = h("div", "panel");
  truths.append(h("h2", "section",
    `世界の真実 — ${m.truths.filter((t) => t.revealed).length}/${m.truths.length}`));
  for (const t of m.truths) {
    truths.append(h("div", t.revealed ? "" : "muted", `${t.id}  ${t.statement}`));
  }
  box.append(truths);

  const ends = h("div", "panel");
  ends.append(h("h2", "section", "Ending"));
  for (const e of m.endings) ends.append(h("div", e.unlocked ? "" : "muted", `${e.id}  ${e.unlocked ? e.name : "???"}`));
  box.append(ends);

  box.append(modalButton("choice", "閉じる", () => {
    overlay.classList.add("hidden");
    overlay.replaceChildren();
  }));

  overlay.replaceChildren(box);
  overlay.classList.remove("hidden");
}

// ------------------------------------------------------------------ boot
async function boot(): Promise<void> {
  const provider = await detectProvider();
  game = new Game(provider, loadMeta());
  view = game.view();
  render();
}

void boot();
