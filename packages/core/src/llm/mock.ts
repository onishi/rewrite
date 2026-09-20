import type {
  LLMProvider, NarrativeRequest, NarrativeResponse, InterpretRequest, InterpretResponse,
  ReactionRequest, ReactionResponse, ConsequenceRequest, ConsequenceResponse, InterpretVerb,
} from "./provider.js";
import { Rng } from "../rng.js";

/**
 * Deterministic provider.  The entire game is playable through this — no API
 * key, no network, no latency (DESIGN §19.3 / SELF_REVIEW Q2).
 *
 * `interpretAction` here is a keyword parser.  It is deliberately dumber than
 * an LLM: it shows exactly how much of the free-action feature is structural
 * rather than generative.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";

  private rngFor(seed: string): Rng { return new Rng(`mock:${seed}`); }

  async generateNarrative(req: NarrativeRequest): Promise<NarrativeResponse> {
    const { state } = req.context;
    const rng = this.rngFor(`${req.beat}:${state.clock}:${state.location}`);
    const openers = [
      `${state.clock}、${state.location}。`,
      `${state.location}に着いた。${state.clock}。`,
      `${state.clock}。${state.location}は静かだ。`,
    ];
    const moods = state.playerHpPct < 35
      ? ["息が上がっている。", "血の匂いが自分のものだと気づく。", "足がもつれる。"]
      : state.distortion >= 6
        ? ["空気に灰が混じっている。", "輪郭がわずかに滲んでいる。", "同じ景色が、少しだけ違う。"]
        : ["風が動いている。", "誰かがいた痕跡がある。", "特に変わったことはない。"];
    const narrative = rng.pick(openers) + rng.pick(moods);

    let foreshadowing: string | null = null;
    const hidden = req.context.worldTruths.filter((t) => !t.revealed);
    if (hidden.length > 0 && rng.chance(0.35)) {
      foreshadowing = rng.pick([
        "教会の鐘が、鳴るべきでない時刻に鳴った。",
        "同じ日付が、帳簿に何度も書かれている。",
        "誰かが、あなたの名を知っているような顔をした。",
        "灰は今日も少しだけ多い。",
      ]);
    }
    return { narrative, foreshadowing };
  }

  async interpretAction(req: InterpretRequest): Promise<InterpretResponse> {
    const raw = req.raw;
    const lower = raw.toLowerCase();
    const table: [RegExp, InterpretVerb][] = [
      [/攻撃|斬|殴|撃|壊|切断|attack|hit/i, "attack"],
      [/壊す|破壊|落と|切り落と|destroy|cut/i, "destroy"],
      [/食べさせ|与え|渡す|飲ませ|give|feed/i, "give"],
      [/説得|交渉|取引|頼|persuade|negotiate/i, "persuade"],
      [/嘘|騙|偽|欺|deceive|lie/i, "deceive"],
      [/盗|掏|steal/i, "steal"],
      [/使う|使って|かける|use/i, "use"],
      [/隠れ|潜|hide/i, "hide"],
      [/見る|調べ|観察|探|observe|look|search/i, "observe"],
      [/行く|移動|向か|move|go/i, "move"],
      [/話|呼ぶ|尋ね|聞く|talk|ask|call/i, "talk"],
    ];
    let verb: InterpretVerb = "other";
    for (const [re, v] of table) { if (re.test(raw)) { verb = v; break; } }

    const target = req.knownTargets.find((t) => raw.includes(t.label) || lower.includes(t.id.toLowerCase()))?.id ?? null;
    const instrument = req.knownInstruments.find((t) => raw.includes(t.label) || lower.includes(t.id.toLowerCase()))?.id ?? null;
    const usesKnowledge = req.context.knowledge
      .filter((k) => {
        const head = k.title.replace(/[はがのをに、。]/g, "").slice(0, 4);
        return head.length >= 2 && raw.includes(head);
      })
      .map((k) => k.id)
      .slice(0, 4);

    return {
      verb, target, instrument, usesKnowledge,
      intentSummary: raw.slice(0, 60),
      confidence: verb === "other" ? 0.3 : target ? 0.8 : 0.55,
    };
  }

  async generateReaction(req: ReactionRequest): Promise<ReactionResponse> {
    const npc = req.context.npc;
    const rng = this.rngFor(`${npc?.id ?? "x"}:${req.event}:${req.context.state.clock}`);
    if (!npc) {
      return { dialogue: "……", mood: "calm", choices: req.allowedActionIds.slice(0, 3).map((a) => ({ actionId: a.id, label: a.hint })) };
    }
    const stage = npc.dejaVuStage;
    const suspicious = req.context.state.suspicion >= 4 || npc.trust < 0;
    const banks: Record<string, string[]> = {
      calm: [`「${npc.publicGoal}。それだけだ」`, "「用があるなら早く言え」", "「今日も同じ一日だ」"],
      suspicious: ["「なぜ、それを知っている」", "「その話は誰から聞いた」", "「……あんた、何者だ」"],
      afraid: ["「やめてくれ」", "「その名を出すな」", "「知らない。何も知らない」"],
      amused: ["「面白いことを言う」", "「ほう」"],
      angry: ["「出て行け」", "「二度と来るな」"],
      broken: ["「……もう、いい」", "「全部、知っていたのか」"],
    };
    let mood: ReactionResponse["mood"] = "calm";
    if (stage >= 2) mood = "suspicious";
    if (suspicious) mood = "suspicious";
    if (req.event.includes("REWRITE")) mood = stage >= 2 ? "afraid" : "suspicious";
    if (req.event.includes("expose") || req.event.includes("lie")) mood = "afraid";

    let dialogue = rng.pick(banks[mood] ?? banks["calm"]!);
    if (stage >= 1 && rng.chance(0.5)) dialogue = `「……前にも、こんなことがあったか」`;

    return {
      dialogue, mood,
      choices: req.allowedActionIds.slice(0, 4).map((a) => ({ actionId: a.id, label: a.hint })),
    };
  }

  async proposeConsequences(req: ConsequenceRequest): Promise<ConsequenceResponse> {
    const rng = this.rngFor(`${req.change}:${req.context.state.clock}`);
    const n = Math.min(req.allowedPrimitives.length, rng.int(1, 2));
    const picks = rng.sample(req.allowedPrimitives, n).map((p) => ({
      primitiveId: p.id,
      magnitude: rng.pick(["low", "mid"] as const),
    }));
    return {
      picks,
      narrative: rng.pick([
        "予定されていた何かが、起きないまま過ぎていった。",
        "誰かが足を止め、別の方向へ歩き出した。",
        "空白ができた。空白は、いつまでも空白ではいられない。",
      ]),
    };
  }
}
