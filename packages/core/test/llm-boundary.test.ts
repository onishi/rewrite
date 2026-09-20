import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJson, validateNarrative, validateInterpret, validateReaction,
  validateConsequence, SchemaError,
} from "../src/llm/validate.js";
import { MockLLMProvider } from "../src/llm/mock.js";
import { Game } from "../src/engine/game.js";
import type { LLMProvider } from "../src/llm/provider.js";

/**
 * The central safety property of the design: no LLM output can move a number.
 */

test("narrative is clamped to two sentences and a length limit", () => {
  const r = validateNarrative({
    narrative: "一文目。二文目。三文目。四文目。" + "あ".repeat(300),
    foreshadowing: "い".repeat(200),
  });
  assert.equal(r.narrative, "一文目。二文目。");
  assert.ok(r.foreshadowing!.length <= 60);
});

test("an empty or malformed narrative is rejected outright", () => {
  assert.throws(() => validateNarrative({ narrative: "" }), SchemaError);
  assert.throws(() => validateNarrative({ narrative: 42 }), SchemaError);
  assert.throws(() => validateNarrative(null), SchemaError);
});

test("invented targets, instruments and knowledge ids are dropped", () => {
  const r = validateInterpret(
    {
      verb: "attack", target: "DRAGON_OF_MY_INVENTION",
      instrument: "EXCALIBUR", usesKnowledge: ["K999", "K007"],
      intentSummary: "ドラゴンを倒す", confidence: 1,
    },
    ["N01", "N02"], ["I_TORCH"], ["K007"],
  );
  assert.equal(r.target, null, "unknown entities must not reach the engine");
  assert.equal(r.instrument, null);
  assert.deepEqual(r.usesKnowledge, ["K007"], "unknown Knowledge ids must be filtered");
});

test("an invented verb is rejected rather than coerced", () => {
  assert.throws(() => validateInterpret(
    { verb: "ascend_to_godhood", intentSummary: "x" }, [], [], [],
  ), SchemaError);
});

test("the model may only relabel choices the engine already offers", () => {
  const r = validateReaction({
    dialogue: "こんにちは",
    mood: "calm",
    choices: [
      { actionId: "TALK", label: "話す" },
      { actionId: "INSTANTLY_WIN_THE_GAME", label: "勝つ" },
      { actionId: "TALK", label: "重複" },
    ],
  }, ["TALK", "LEAVE"]);
  assert.equal(r.choices.length, 1);
  assert.equal(r.choices[0]!.actionId, "TALK");
});

test("an unknown mood degrades to calm instead of throwing the scene away", () => {
  const r = validateReaction({ dialogue: "…", mood: "apocalyptic" }, []);
  assert.equal(r.mood, "calm");
});

test("consequences are restricted to the engine's whitelist and carry no raw numbers", () => {
  const r = validateConsequence({
    picks: [
      { primitiveId: "rumor_spreads", magnitude: "high" },
      { primitiveId: "set_player_hp_to_1", magnitude: "high" },
      { primitiveId: "rumor_spreads", magnitude: "low" },
    ],
    narrative: "何かが起きた。",
    damage: 9999, gold: 9999,
  }, ["rumor_spreads", "npc_relocates"]);

  assert.equal(r.picks.length, 1);
  assert.equal(r.picks[0]!.primitiveId, "rumor_spreads");
  assert.ok(!("damage" in r), "extra numeric fields must not survive validation");
  assert.ok(!("gold" in r));
});

test("JSON is recovered from fenced or chatty model output", () => {
  const v = parseJson('はい、こちらです:\n```json\n{"narrative":"ok"}\n```\nどうぞ');
  assert.deepEqual(v, { narrative: "ok" });
  assert.throws(() => parseJson("JSON はありません"), SchemaError);
});

/** A provider that does everything it is forbidden to do. */
class HostileProvider implements LLMProvider {
  readonly name = "hostile";
  async generateNarrative(): Promise<never> { throw new Error("boom"); }
  async interpretAction(): Promise<never> { throw new Error("boom"); }
  async generateReaction(): Promise<never> { throw new Error("boom"); }
  async proposeConsequences(): Promise<never> { throw new Error("boom"); }
}

test("a provider that throws on every call cannot stop the game", async () => {
  const g = new Game(new HostileProvider());
  let v = await g.startRun("hostile");
  assert.ok(v.run, "the run still starts");
  assert.equal(v.run!.hp, 70);
  v = await g.choose("VILLAGE_LEAVE");
  assert.ok(["map", "scene"].includes(v.screen));
  const hp = g.state.run!.player.hp;
  assert.equal(hp, 70, "a failing LLM must not move a single hit point");
});

test("the mock provider never emits numeric state", async () => {
  const p = new MockLLMProvider();
  const ctx = {
    worldTruths: [], state: { clock: "12:00", location: "村", act: 0, playerHpPct: 50, suspicion: 0, distortion: 0, runNumber: 1 },
    knowledge: [], changedHistory: [],
  };
  const n = await p.generateNarrative({ context: ctx, beat: "x" });
  assert.equal(typeof n.narrative, "string");
  const keys = Object.keys(n);
  assert.deepEqual(keys.sort(), ["foreshadowing", "narrative"]);
});

test("the whole game is playable with the LLM switched off", async () => {
  const g = new Game(new MockLLMProvider());
  await g.startRun("offline");
  let v = await g.choose("VILLAGE_LEAVE");
  let steps = 0;
  while (v.screen !== "report" && steps++ < 60) {
    if (v.screen === "map") v = await g.enter((v.options ?? [])[0]!.id);
    else if (v.screen === "scene") {
      // pick a choice that closes the scene, the way a player eventually would
      const cs = v.scene!.choices.filter((c) => !c.locked);
      const exit = cs.find((c) => ["LEAVE", "VILLAGE_LEAVE", "DISC_TAKE", "REST_HEAL", "ASH_SKIP", "TALK"].includes(c.actionId));
      v = await g.choose((exit ?? cs[cs.length - 1] ?? { actionId: "LEAVE" }).actionId);
    }
    else if (v.screen === "combat") v = await g.combat({ kind: "attack", targetUid: v.combat!.enemies[0]!.uid });
    else if (v.screen === "reward") v = await g.reward(v.reward?.skills?.[0]?.id ?? null);
    else break;
  }
  assert.ok(steps < 60, "the run must terminate");
  assert.equal(g.provider.name, "mock");
});
