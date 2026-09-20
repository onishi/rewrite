import test from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/rng.js";
import { newMeta, startRun } from "../src/engine/run.js";
import { startCombat, playerAction, spawnEnemy, elementMultiplier } from "../src/engine/combat.js";
import type { CombatContext } from "../src/engine/combat.js";

function ctx(seed = "t"): CombatContext {
  const meta = newMeta();
  const run = startRun(meta, seed);
  return { meta, run, rng: new Rng(seed) };
}

test("combat resolves: 100 auto-battles all terminate", () => {
  let wins = 0, losses = 0;
  for (let i = 0; i < 100; i++) {
    const c = ctx(`fight-${i}`);
    const state = startCombat(c, { enemyIds: ["E_DOG", "E_BANDIT"] });
    let turns = 0;
    while (state.phase === "player" && turns++ < 60) {
      playerAction(c, state, { kind: "attack", targetUid: state.enemies.find((e) => e.hp > 0)!.uid });
    }
    assert.notEqual(state.phase, "player", `fight ${i} never ended`);
    if (state.phase === "won") wins++;
    if (state.phase === "lost") losses++;
  }
  assert.ok(wins > 0, "player should sometimes win");
  assert.equal(wins + losses, 100);
});

test("a turtling player still loses: fatigue breaks stalemates", () => {
  const c = ctx("stall");
  const state = startCombat(c, { bossId: "B_VANE" });
  let turns = 0;
  while (state.phase === "player" && turns++ < 100) {
    playerAction(c, state, { kind: "defend" });
  }
  assert.equal(state.phase, "lost", "defending forever must not be a winning strategy");
  assert.ok(turns < 60, "fatigue should end it well before the guard limit");
});

test("enemy Guard expires instead of accumulating", () => {
  const c = ctx("guard");
  const state = startCombat(c, { enemyIds: ["E_KNIGHT"] });
  const e = state.enemies[0]!;
  e.guard = 999;
  // force the enemy to act
  playerAction(c, state, { kind: "attack", targetUid: e.uid });
  assert.ok(e.guard < 999, "guard must reset when the enemy takes its turn");
});

test("boss transitions to phase 2 rather than dying", () => {
  const c = ctx("phase");
  const state = startCombat(c, { bossId: "B_VANE" });
  const boss = state.enemies[0]!;
  assert.equal(boss.phase, 0);
  boss.hp = 1;
  playerAction(c, state, { kind: "attack", targetUid: boss.uid });
  assert.equal(boss.phase, 1, "should be in phase 2");
  assert.ok(boss.hp > 1, "phase 2 has its own health pool");
  assert.ok(boss.tags.includes("phase2"));
});

test("lightning doubles against wet and metal targets", () => {
  const meta = newMeta();
  const leech = spawnEnemy("E_LEECH", 0);
  const dog = spawnEnemy("E_DOG", 1);
  assert.equal(elementMultiplier(meta, leech, "lightning"), 2);
  assert.equal(elementMultiplier(meta, dog, "lightning"), 1);
});

test("Guard absorbs before HP", () => {
  const c = ctx("g2");
  const state = startCombat(c, { enemyIds: ["E_DOG"] });
  const before = c.run.player.hp;
  playerAction(c, state, { kind: "defend" });
  assert.ok(c.run.player.hp >= before - 2, "a defended turn should cost almost nothing");
});

test("feints are hidden without Liar's Eye and revealed with it", () => {
  const plain = ctx("feint-a");
  plain.run.player.skills = [];
  const s1 = startCombat(plain, { enemyIds: ["E_KNIGHT"] });
  const seer = ctx("feint-a");
  seer.run.player.skills = ["S01"];
  const s2 = startCombat(seer, { enemyIds: ["E_KNIGHT"] });
  const i1 = Object.values(s1.intents)[0]!;
  const i2 = Object.values(s2.intents)[0]!;
  if (i1.isFeint) {
    assert.equal(i1.detected, false);
    assert.notEqual(i1.shown, "feint");
  }
  if (i2.isFeint) assert.equal(i2.detected, true);
});

test("the same seed produces the same fight", () => {
  const run = (): number[] => {
    const c = ctx("determinism");
    const state = startCombat(c, { enemyIds: ["E_BANDIT", "E_DOG"] });
    const hps: number[] = [];
    for (let i = 0; i < 6 && state.phase === "player"; i++) {
      playerAction(c, state, { kind: "attack", targetUid: state.enemies.find((e) => e.hp > 0)!.uid });
      hps.push(c.run.player.hp, ...state.enemies.map((e) => e.hp));
    }
    return hps;
  };
  assert.deepEqual(run(), run());
});
