import test from "node:test";
import assert from "node:assert/strict";
import { Game, MockLLMProvider } from "../src/index.js";
import { playRun, type SimLog } from "./sim/auto-player.js";

/**
 * Regression guard for the experience the MVP exists to prove (DESIGN §22):
 * play normally -> knowledge becomes leverage -> a rewrite changes the world.
 */
test("three consecutive runs escalate from ignorance to leverage to a rewritten world", async () => {
  const g = new Game(new MockLLMProvider());
  const log: SimLog = { lines: [] };

  const r1 = await playRun(g, "mvp-1", "greedy-knowledge", log);
  const k1 = Object.keys(g.state.meta.knowledge).length;
  assert.ok(r1.report, "run 1 must end in a report");
  assert.ok(k1 >= 3, `run 1 should teach the player several things, got ${k1}`);
  assert.ok(r1.report!.nextRunUnlocks.length > 0, "run 1 must end with a reason to press REWRITE");

  const r2 = await playRun(g, "mvp-2", "use-knowledge", log);
  const k2 = Object.keys(g.state.meta.knowledge).length;
  assert.ok(k2 > k1, "run 2 must add to what is known");
  assert.ok(g.state.meta.executedRewrites.length > 0 || r2.report!.nextRunUnlocks.some((u) => u.includes("REWRITE")),
    "by run 2 a REWRITE must be on the table");

  const r3 = await playRun(g, "mvp-3", "rewrite", log);
  assert.ok(g.state.meta.executedRewrites.length > 0, "run 3 must actually rewrite history");
  assert.ok(r3.report!.historyRewritten.length > 0, "and the report must say so");

  const invalidated = Object.values(g.state.meta.knowledge).filter((k) => k.reliability === "invalidated");
  assert.ok(invalidated.length > 0, "rewriting must cost knowledge — the paradox has to bite");
  assert.ok(g.state.meta.distortion > 0, "the world must be measurably more worn");

  const truths = Object.keys(g.state.meta.worldTruthDisclosure).length;
  assert.ok(truths >= 2, `mystery growth should have advanced, got ${truths} truths`);
});

test("knowledge carried between runs visibly changes the board", async () => {
  const g = new Game(new MockLLMProvider());
  const log: SimLog = { lines: [] };
  await playRun(g, "board-1", "greedy-knowledge", log);
  await playRun(g, "board-2", "use-knowledge", log);

  const text = log.lines.join("\n");
  assert.ok(
    /Knowledge|KNOWLEDGE/.test(text),
    "a later run must visibly use what the player already knows",
  );
});

test("a descent covers several floors inside the clock budget", async () => {
  const g = new Game(new MockLLMProvider());
  const log: SimLog = { lines: [] };
  await playRun(g, "length", "rewrite", log);
  const run = g.state.run!;
  assert.ok(run.floorsVisited.length >= 2,
    `a run should reach at least the second floor, got ${run.floorsVisited.length}`);
  assert.ok(run.clock >= 6 * 60, "the clock only moves forward from dawn");
  assert.ok(run.clock <= 32 * 60, `the clock should not run wild, got ${run.clock}`);
});
