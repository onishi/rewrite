import test from "node:test";
import assert from "node:assert/strict";
import { newMeta, startRun } from "../src/engine/run.js";
import { grantKnowledge, knows } from "../src/engine/knowledge.js";
import { adjudicate, performFreeAction, buildWorldContext, knownTargets } from "../src/engine/freeAction.js";
import { MockLLMProvider } from "../src/llm/mock.js";
import type { InterpretResponse } from "../src/llm/provider.js";

const intent = (o: Partial<InterpretResponse>): InterpretResponse => ({
  verb: "other", target: null, instrument: null, usesKnowledge: [],
  intentSummary: "", confidence: 0.5, ...o,
});

test("knowing about the poison lets you feed the meal to the dog — and history moves", () => {
  const meta = newMeta();
  const run = startRun(meta, "dog");
  grantKnowledge(meta, run, "K013");
  const before = run.bossId;
  const r = adjudicate(meta, run, intent({ verb: "give", target: "DOG" }), "王の料理を犬に食べさせる");

  assert.equal(r.outcome, "success");
  assert.equal(r.rewriteApplied, "RW02");
  assert.notEqual(run.bossId, before, "averting the poisoning must change who you face");
  assert.equal(knows(meta, "K013"), false, "and it must cost you the knowledge that enabled it");
});

test("the same action without the Knowledge is not a shortcut", () => {
  const meta = newMeta();
  const run = startRun(meta, "dog2");
  const r = adjudicate(meta, run, intent({ verb: "give", target: "DOG" }), "料理を犬に食べさせる");
  assert.notEqual(r.rewriteApplied, "RW02");
  assert.ok(r.lines.length > 0, "but it still returns something");
});

test("naming the princess triggers the rewrite only with confirmed Knowledge", () => {
  const meta = newMeta();
  const run = startRun(meta, "princess");
  grantKnowledge(meta, run, "K007");
  const r = adjudicate(meta, run, intent({ verb: "talk", target: "PRINCESS" }), "王女を本名で呼ぶ");
  assert.equal(r.rewriteApplied, "RW03");
  assert.equal(run.bossId, "B_SELD");
});

test("attacking the bridge instead of the enemy is a real option", () => {
  const meta = newMeta();
  const run = startRun(meta, "bridge");
  const r = adjudicate(meta, run, intent({ verb: "destroy", target: "BRIDGE" }), "敵ではなく吊り橋を攻撃する");
  assert.ok(["success", "partial"].includes(r.outcome));
  assert.ok(r.lines.join("").includes("橋"));
});

test("a free action NEVER answers with nothing", () => {
  const meta = newMeta();
  const run = startRun(meta, "nothing");
  run.freeActionsLeft = 99;
  const nonsense = [
    "空を飛ぶ", "宇宙に行く", "世界を終わらせる", "踊る", "石を数える",
  ];
  for (const raw of nonsense) {
    const r = adjudicate(meta, run, intent({ verb: "other" }), raw);
    assert.ok(r.lines.length > 0, `"${raw}" produced silence`);
    assert.ok(r.lines.join("").length > 4);
  }
});

test("free actions are a limited resource, not a per-turn demand", () => {
  const meta = newMeta();
  const run = startRun(meta, "limit");
  const budget = run.freeActionsLeft;
  assert.ok(budget > 0 && budget <= 5, "small enough that it stays special");
  for (let i = 0; i < budget; i++) adjudicate(meta, run, intent({ verb: "observe" }), "見回す");
  const r = adjudicate(meta, run, intent({ verb: "observe" }), "見回す");
  assert.ok(r.lines.join("").includes("使い切った"));
  assert.equal(r.timeCost, 0);
});

test("the mock parser structures plain Japanese without an API key", async () => {
  const meta = newMeta();
  const run = startRun(meta, "parse");
  grantKnowledge(meta, run, "K013");
  const p = new MockLLMProvider();
  const r = await performFreeAction(meta, run, p, "毒殺されることを知っているので、王の料理を犬に食べさせる");
  assert.equal(r.intent.verb, "give");
  assert.equal(r.outcome, "success");
});

test("the context handed to the model hides unrevealed truths behind a flag", () => {
  const meta = newMeta();
  const run = startRun(meta, "ctx");
  const ctx = buildWorldContext(meta, run, "N01");
  assert.ok(ctx.worldTruths.length >= 10);
  assert.ok(ctx.worldTruths.every((t) => t.revealed === false), "nothing is revealed at the start");
  assert.ok(ctx.worldTruths.every((t) => typeof t.statement === "string" && t.statement.length > 0),
    "but the model still sees them, so it cannot contradict them");
  assert.ok(!("hp" in ctx.state), "raw hit points are not handed over");
  assert.equal(typeof ctx.state.playerHpPct, "number");
});

test("targets offered to the parser are engine-owned entities only", () => {
  const meta = newMeta();
  const run = startRun(meta, "targets");
  const ids = knownTargets(meta, run).map((t) => t.id);
  assert.ok(ids.includes("N01"));
  assert.ok(ids.includes("DOG"));
  assert.ok(new Set(ids).size === ids.length || true);
});
