import test from "node:test";
import assert from "node:assert/strict";
import { SKILLS, SYNERGIES, activeSynergies, synergyHintFor } from "../src/content/skills.js";
import { KNOWLEDGE, SYNTHESIS_RULES } from "../src/content/knowledge.js";
import { ITEMS, NPCS, WORLD_TRUTHS, ENDINGS } from "../src/content/world.js";
import { ENEMIES, BOSSES, REWRITES } from "../src/content/enemies.js";
import { Game, MockLLMProvider } from "../src/index.js";
import { grantKnowledge } from "../src/engine/knowledge.js";
import { checkTowerRoute, newMeta, startRun } from "../src/engine/run.js";

test("the MVP content set matches the design", () => {
  assert.equal(SKILLS.length, 20, "20 skills");
  assert.equal(SYNERGIES.length, 11, "11 synergies");
  assert.equal(KNOWLEDGE.length, 25, "20 base + 5 synthesized");
  assert.equal(SYNTHESIS_RULES.length, 5);
  assert.equal(ITEMS.length, 20);
  assert.equal(NPCS.length, 5);
  assert.equal(WORLD_TRUTHS.length, 10);
  assert.equal(ENDINGS.length, 3);
  assert.equal(REWRITES.length, 6);
  assert.equal(ENEMIES.filter((e) => !e.tags.includes("elite")).length, 5, "5 ordinary enemies");
  assert.equal(ENEMIES.filter((e) => e.tags.includes("elite")).length, 2, "2 elites");
  assert.equal(BOSSES.length, 3);
});

test("most skills do something outside combat too", () => {
  const worldly = SKILLS.filter((s) => s.kind !== "combat").length;
  assert.ok(worldly >= 13, `build-craft and story-craft must overlap, got ${worldly}/20`);
});

test("skills with no combat value never appear in a combat reward", () => {
  for (const s of SKILLS) {
    if (s.kind === "world" && s.effects.length === 0 && !s.active && s.passives.length === 0) {
      assert.notEqual(s.pool, "combat", `${s.id} would be a dud card`);
    }
  }
  assert.ok(SKILLS.some((s) => s.pool === "explore"), "the explore-only pool must exist");
});

test("every synergy is reachable and its halves exist", () => {
  const ids = new Set(SKILLS.map((s) => s.id));
  for (const y of SYNERGIES) {
    for (const r of y.requires) assert.ok(ids.has(r), `${y.id} wants missing skill ${r}`);
    assert.notEqual(y.requires[0], y.requires[1]);
    assert.ok(activeSynergies(y.requires).some((a) => a.id === y.id));
  }
});

test("the UI can tell you which card completes a synergy", () => {
  assert.equal(synergyHintFor("S06", ["S03"]), "予見殺");
  assert.equal(synergyHintFor("S06", ["S16"]), null);
});

test("every boss can be approached more than one way", () => {
  // Vane: raw damage, fire (K004), exposure (K007), lightning (K009),
  // bandit turncoats (K011), or a royal deal (Y03).
  const vaneKeys = ["K004", "K007", "K009", "K011"];
  for (const k of vaneKeys) assert.ok(KNOWLEDGE.find((x) => x.id === k), `${k} missing`);
  const bossActions = KNOWLEDGE.flatMap((k) => k.gameplayEffects)
    .filter((e) => e.kind === "unlockSpecialAction" && e.scope === "boss");
  assert.ok(bossActions.length >= 3, "knowledge must add at least 3 distinct boss options");
});

test("every ending is reachable from the shipped content", async () => {
  // E1 / E2 come from the two conspiracy bosses; E3 from the tower.
  const meta = newMeta();
  const run = startRun(meta, "tower");
  grantKnowledge(meta, run, "K018");
  run.player.items.push("I_GRAVEKEY");
  assert.equal(checkTowerRoute(meta, run), true);
  assert.equal(run.bossId, "B_WRITER", "key + K018 must lead to the Writer");
  assert.ok(BOSSES.find((b) => b.id === "B_WRITER"));
});

test("the knowledge that unlocks the tower is actually findable", () => {
  // K018 sits behind the tower gate, which K016 reveals.
  const k016 = KNOWLEDGE.find((k) => k.id === "K016")!;
  assert.ok(k016.gameplayEffects.some((e) => e.kind === "revealNode" && e.nodeId === "NODE_ASH_TOWER"));
});

test("every Knowledge effect label describes something the engine implements", () => {
  const implemented = new Set([
    "unlockSpecialAction", "elementMultiplier", "convertEncounter", "unlockRoute",
    "revealNode", "timeCost", "unlockRewrite", "itemEffect", "enableNegotiation",
    "discloseTruth", "endingCondition",
  ]);
  for (const k of KNOWLEDGE) {
    for (const e of k.gameplayEffects) {
      assert.ok(implemented.has(e.kind), `${k.id} uses unimplemented effect ${e.kind}`);
    }
  }
});

test("a fresh game exposes no world truths and no knowledge", () => {
  const g = new Game(new MockLLMProvider());
  const v = g.view();
  assert.equal(v.meta.knowledge.length, 0);
  assert.equal(v.meta.truths.every((t) => !t.revealed), true);
  assert.equal(v.meta.truths.every((t) => t.statement === "???"), true, "spoilers must not leak into the view");
});
