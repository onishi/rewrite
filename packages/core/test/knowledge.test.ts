import test from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/rng.js";
import { newMeta, startRun, applyRewrite, buildReport } from "../src/engine/run.js";
import {
  grantKnowledge, knows, invalidate, rollStructural, applyDistortionDecay,
  RELIABILITY_PROC, specialActionsFor,
} from "../src/engine/knowledge.js";
import { KNOWLEDGE, SYNTHESIS_RULES, nearSynthesis } from "../src/content/knowledge.js";

test("every Knowledge entry carries at least one rule or an explicit label", () => {
  for (const k of KNOWLEDGE) {
    assert.ok(k.effectLabels.length > 0, `${k.id} has no effect labels`);
    assert.ok(k.title.length > 0 && k.description.length > 0, `${k.id} is incomplete`);
  }
});

test("synthesis fires the instant both halves are held", () => {
  const meta = newMeta();
  const run = startRun(meta, "synth");
  grantKnowledge(meta, run, "K005");
  assert.equal(meta.knowledge["K021"], undefined, "one half is not enough");
  const acq = grantKnowledge(meta, run, "K006");
  assert.ok(meta.knowledge["K021"], "K005 + K006 must produce K021");
  assert.ok(acq.some((a) => a.id === "K021" && a.synthesized), "the card must be flagged as synthesized");
});

test("synthesis can downgrade: K023 makes the lightning weakness unreliable", () => {
  const meta = newMeta();
  const run = startRun(meta, "downgrade");
  grantKnowledge(meta, run, "K009");
  assert.equal(meta.knowledge["K009"]!.reliability, "confirmed");
  grantKnowledge(meta, run, "K017");
  assert.ok(meta.knowledge["K023"], "K009 + K017 must produce K023");
  assert.equal(meta.knowledge["K009"]!.reliability, "uncertain",
    "knowing that Vane adapts must make the old weakness shakier");
});

test("re-observing the same fact upgrades confidence but never downgrades it", () => {
  const meta = newMeta();
  const run = startRun(meta, "upgrade");
  grantKnowledge(meta, run, "K014", { reliability: "rumor" });
  assert.equal(meta.knowledge["K014"]!.reliability, "rumor");
  grantKnowledge(meta, run, "K014", { reliability: "confirmed" });
  assert.equal(meta.knowledge["K014"]!.reliability, "confirmed");
  grantKnowledge(meta, run, "K014", { reliability: "rumor" });
  assert.equal(meta.knowledge["K014"]!.reliability, "confirmed", "must not regress");
});

test("invalidated Knowledge stops counting as known and never revives", () => {
  const meta = newMeta();
  const run = startRun(meta, "inv");
  grantKnowledge(meta, run, "K007");
  assert.ok(knows(meta, "K007"));
  invalidate(meta, ["K007"], "RW03");
  assert.equal(knows(meta, "K007"), false);
  grantKnowledge(meta, run, "K007");
  assert.equal(meta.knowledge["K007"]!.reliability, "invalidated", "you cannot re-learn a future you erased");
});

test("reliability controls how often structural effects actually apply", () => {
  const meta = newMeta();
  const run = startRun(meta, "proc");
  grantKnowledge(meta, run, "K005", { reliability: "uncertain" });
  let live = 0;
  for (let i = 0; i < 400; i++) if (rollStructural(meta, new Rng(`p${i}`)).has("K005")) live++;
  const rate = live / 400;
  assert.ok(Math.abs(rate - RELIABILITY_PROC.uncertain) < 0.08, `uncertain fired at ${rate}`);
});

test("distortion erodes schedule knowledge", () => {
  const meta = newMeta();
  const run = startRun(meta, "distort");
  grantKnowledge(meta, run, "K005", { reliability: "confirmed" });
  meta.distortion = 7;
  const hit = applyDistortionDecay(meta);
  assert.ok(hit.includes("K005"));
  assert.equal(meta.knowledge["K005"]!.reliability, "uncertain");
});

test("Knowledge appears as a combat button, not as prose", () => {
  const meta = newMeta();
  const run = startRun(meta, "special");
  grantKnowledge(meta, run, "K007");
  const actions = specialActionsFor({
    meta, run, enemies: [], isBoss: true, bossId: "B_SELD",
    synergyFlags: new Set(), hasItem: () => true, hasSkill: () => true,
  });
  assert.ok(actions.some((a) => a.id === "SA_EXPOSE_PRINCESS"), "K007 must produce a boss action");
});

test("the codex hints at combinations that are one piece away", () => {
  const held = new Set(["K005"]);
  const hints = nearSynthesis(held);
  assert.ok(hints.some((h) => h.id === "K021" && h.missing.includes("K006")));
});

test("every synthesis rule points at a real, reachable entry", () => {
  for (const r of SYNTHESIS_RULES) {
    assert.ok(KNOWLEDGE.find((k) => k.id === r.id), `${r.id} missing`);
    for (const req of r.requires) assert.ok(KNOWLEDGE.find((k) => k.id === req), `${req} missing`);
  }
});
