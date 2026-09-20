import type {
  LLMProvider, NarrativeRequest, NarrativeResponse, InterpretRequest, InterpretResponse,
  ReactionRequest, ReactionResponse, ConsequenceRequest, ConsequenceResponse, WorldContext,
} from "./provider.js";
import { MockLLMProvider } from "./mock.js";
import {
  parseJson, validateNarrative, validateInterpret, validateReaction, validateConsequence, SCHEMAS,
} from "./validate.js";

/**
 * Runs SERVER-SIDE ONLY.  The API key never leaves the Node process
 * (DESIGN §19.4).  Every call falls back to the mock provider on any failure,
 * so a dead network degrades prose, never gameplay.
 */

const SYSTEM = `あなたはローグライクゲーム「REWRITE」の物語生成エンジンです。ゲームマスターではありません。

厳守事項:
1. HP・ダメージ・所持金・時刻・アイテム・成功/失敗の判定を書いてはいけません。それらは全てゲームエンジンが決定済みです。
   「敵を倒した」「〜を手に入れた」のような結果の断定は禁止です。描写のみを行ってください。
2. world_truths のうち revealed:false のものを断定してはいけません。ただし矛盾する記述も禁止です。示唆・伏線は許可します。
3. 文章は短く。narrative は2文以内。プレイヤーは読むのではなく遊んでいます。
4. 必ず指定された JSON スキーマに従った JSON のみを出力してください。前置きや説明は不要です。
5. choices の actionId は、与えられた allowedActionIds の中からのみ選んでください。新しい actionId を発明してはいけません。`;

function contextBlock(c: WorldContext): string {
  return JSON.stringify({
    world_truths: c.worldTruths,
    npc: c.npc,
    state: c.state,
    player_knowledge: c.knowledge,
    changed_history: c.changedHistory,
    player_action: c.playerAction,
  }, null, 1);
}

export interface AnthropicOpts {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onFallback?: (stage: string, reason: string) => void;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private mock = new MockLLMProvider();
  private model: string;
  private timeoutMs: number;

  constructor(private opts: AnthropicOpts) {
    this.model = opts.model ?? "claude-sonnet-5";
    this.timeoutMs = opts.timeoutMs ?? 12000;
  }

  private async call(prompt: string, schema: unknown, maxTokens = 400): Promise<unknown> {
    const f = this.opts.fetchImpl ?? fetch;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await f("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: ac.signal,
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens,
          system: SYSTEM,
          messages: [{
            role: "user",
            content: `${prompt}\n\n出力する JSON のスキーマ:\n${JSON.stringify(schema)}\n\nJSON のみを出力してください。`,
          }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const body = await res.json() as { content?: { type: string; text?: string }[] };
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      return parseJson(text);
    } finally {
      clearTimeout(timer);
    }
  }

  async generateNarrative(req: NarrativeRequest): Promise<NarrativeResponse> {
    try {
      const raw = await this.call(
        `次の場面を描写してください。\nbeat: ${req.beat}\ncontext:\n${contextBlock(req.context)}`,
        SCHEMAS.narrative, 300,
      );
      return validateNarrative(raw);
    } catch (e) {
      this.opts.onFallback?.("generateNarrative", String(e));
      return this.mock.generateNarrative(req);
    }
  }

  async interpretAction(req: InterpretRequest): Promise<InterpretResponse> {
    try {
      const raw = await this.call(
        `プレイヤーの自由入力を構造化してください。判定はしないでください。\n` +
        `入力: 「${req.raw}」\n` +
        `target に使える id: ${JSON.stringify(req.knownTargets)}\n` +
        `instrument に使える id: ${JSON.stringify(req.knownInstruments)}\n` +
        `context:\n${contextBlock(req.context)}`,
        SCHEMAS.interpret, 350,
      );
      return validateInterpret(
        raw,
        req.knownTargets.map((t) => t.id),
        req.knownInstruments.map((t) => t.id),
        req.context.knowledge.map((k) => k.id),
      );
    } catch (e) {
      this.opts.onFallback?.("interpretAction", String(e));
      return this.mock.interpretAction(req);
    }
  }

  async generateReaction(req: ReactionRequest): Promise<ReactionResponse> {
    try {
      const raw = await this.call(
        `NPC の反応を生成してください。\nevent: ${req.event}\n` +
        `allowedActionIds: ${JSON.stringify(req.allowedActionIds)}\n` +
        `context:\n${contextBlock(req.context)}`,
        SCHEMAS.reaction, 400,
      );
      const r = validateReaction(raw, req.allowedActionIds.map((a) => a.id));
      // A reaction that dropped every choice is useless; fall back to engine labels.
      if (r.choices.length === 0) r.choices = req.allowedActionIds.slice(0, 4).map((a) => ({ actionId: a.id, label: a.hint }));
      return r;
    } catch (e) {
      this.opts.onFallback?.("generateReaction", String(e));
      return this.mock.generateReaction(req);
    }
  }

  async proposeConsequences(req: ConsequenceRequest): Promise<ConsequenceResponse> {
    try {
      const raw = await this.call(
        `世界の変化の余波を提案してください。提案できるのは allowedPrimitives の id のみです。\n` +
        `change: ${req.change}\n` +
        `allowedPrimitives: ${JSON.stringify(req.allowedPrimitives)}\n` +
        `context:\n${contextBlock(req.context)}`,
        SCHEMAS.consequence, 400,
      );
      return validateConsequence(raw, req.allowedPrimitives.map((p) => p.id));
    } catch (e) {
      this.opts.onFallback?.("proposeConsequences", String(e));
      return this.mock.proposeConsequences(req);
    }
  }
}
