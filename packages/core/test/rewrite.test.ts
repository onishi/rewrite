import test from "node:test";
import assert from "node:assert/strict";
import { newMeta, startRun, applyRewrite, availableRewrites, buildReport, onDeath } from "../src/engine/run.js";
import { grantKnowledge, knows } from "../src/engine/knowledge.js";
import { REWRITES } from "../src/content/enemies.js";

test("a REWRITE is only offered once its Knowledge is actually held", () => {
  const meta = newMeta();
  const run = startRun(meta, "rw-gate");
  assert.equal(availableRewrites(meta, run).length, 0, "nothing is rewritable on a blank slate");
  grantKnowledge(meta, run, "K007");
  assert.ok(availableRewrites(meta, run).some((r) => r.id === "RW03"));
});

test("RW03 swaps the boss and burns the Knowledge that enabled it", () => {
  const meta = newMeta();
  const run = startRun(meta, "rw3");
  grantKnowledge(meta, run, "K007");
  assert.equal(run.map.bossId, "B_VANE");
  const res = applyRewrite(meta, run, "RW03");

  assert.equal(run.map.bossId, "B_SELD", "the confrontation itself must change");
  assert.ok(res.invalidated.includes("K007"), "the rewrite must consume its own premise");
  assert.equal(knows(meta, "K007"), false);
  assert.ok(meta.distortion >= 3);
  assert.ok(run.worldDeltas.some((d) => d.rewriteId === "RW03"));
});

test("every REWRITE burns at least one Knowledge — the paradox is structural", () => {
  for (const rw of REWRITES) {
    const invalidates = rw.effects.filter((e) => e.kind === "invalidate");
    assert.ok(invalidates.length > 0, `${rw.id} changes history for free`);
    const total = invalidates.flatMap((e) => (e as { knowledge: string[] }).knowledge);
    assert.ok(total.length > 0, `${rw.id} invalidates nothing`);
  }
});

test("every REWRITE changes the board, not only the story", () => {
  const boardKinds = new Set([
    "injectNode", "removeNode", "swapBoss", "dangerShift",
    "grantItem", "unlockRoute", "allyNextFight", "killNpc", "cancelScheduledEvent",
  ]);
  for (const rw of REWRITES) {
    assert.ok(rw.effects.some((e) => boardKinds.has(e.kind)),
      `${rw.id} only moves prose around`);
  }
});

test("the same REWRITE cannot be replayed within a run", () => {
  const meta = newMeta();
  const run = startRun(meta, "rw-once");
  grantKnowledge(meta, run, "K011");
  assert.ok(availableRewrites(meta, run).some((r) => r.id === "RW05"));
  applyRewrite(meta, run, "RW05");
  assert.equal(availableRewrites(meta, run).some((r) => r.id === "RW05"), false);
});

test("the run report lists gains only, never losses", () => {
  const meta = newMeta();
  const run = startRun(meta, "report");
  grantKnowledge(meta, run, "K007");
  run.player.gold = 240;
  run.player.level = 5;
  onDeath(meta, run, "戦闘で倒れた");
  const r = buildReport(meta, run);

  const blob = JSON.stringify(r);
  for (const banned of ["失いました", "を失った", "ロスト", "Lost"]) {
    assert.ok(!blob.includes(banned), `report must not dwell on losses (${banned})`);
  }
  assert.ok(r.newKnowledge.some((k) => k.id === "K007"));
  assert.ok(r.newKnowledge[0]!.effects.length > 0, "each entry must show the rules it unlocked");
  assert.ok(r.nextRunUnlocks.length > 0, "the report must always answer 'why press REWRITE'");
  assert.ok(r.rewriteButtonLabel.includes("REWRITE"));
  assert.ok(r.epitaph.length > 0);
});

test("losing to a boss still teaches you something", () => {
  const meta = newMeta();
  const run = startRun(meta, "consolation");
  const acq = onDeath(meta, run, "騎士団長ヴェイン に敗れた", "B_VANE");
  assert.ok(acq.some((a) => a.id === "K009"), "defeat must hand over the phase-2 weakness");
  assert.ok(knows(meta, "K009"));
});

test("Knowledge survives death; everything else does not", () => {
  const meta = newMeta();
  const run1 = startRun(meta, "persist-1");
  grantKnowledge(meta, run1, "K004");
  run1.player.gold = 500;
  run1.player.skills.push("S07");
  onDeath(meta, run1, "戦闘で倒れた");

  const run2 = startRun(meta, "persist-2");
  assert.ok(knows(meta, "K004"), "Knowledge carries over");
  assert.ok(run2.player.gold < 100, "gold does not");
  assert.equal(run2.player.level, 1, "level does not");
  assert.equal(run2.worldDeltas.length, 0);
});
