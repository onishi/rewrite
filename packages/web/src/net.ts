import type {
  LLMProvider, NarrativeRequest, NarrativeResponse, InterpretRequest, InterpretResponse,
  ReactionRequest, ReactionResponse, ConsequenceRequest, ConsequenceResponse,
} from "../../core/src/llm/provider.js";
import { MockLLMProvider } from "../../core/src/llm/mock.js";
import {
  validateNarrative, validateInterpret, validateReaction, validateConsequence,
} from "../../core/src/llm/validate.js";

/**
 * Browser-side provider.  It never holds a key — it posts to the local server,
 * which owns ANTHROPIC_API_KEY.  Responses are validated a second time here:
 * the client trusts the server no more than the server trusts the model.
 */
export class HttpLLMProvider implements LLMProvider {
  readonly name: string;
  private mock = new MockLLMProvider();

  constructor(serverProviderName: string) {
    this.name = serverProviderName;
  }

  private async post(method: string, payload: unknown): Promise<unknown> {
    const res = await fetch(`/api/llm/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`llm ${method} ${res.status}`);
    return res.json();
  }

  async generateNarrative(req: NarrativeRequest): Promise<NarrativeResponse> {
    try { return validateNarrative(await this.post("generateNarrative", req)); }
    catch { return this.mock.generateNarrative(req); }
  }

  async interpretAction(req: InterpretRequest): Promise<InterpretResponse> {
    try {
      return validateInterpret(
        await this.post("interpretAction", req),
        req.knownTargets.map((t) => t.id),
        req.knownInstruments.map((t) => t.id),
        req.context.knowledge.map((k) => k.id),
      );
    } catch { return this.mock.interpretAction(req); }
  }

  async generateReaction(req: ReactionRequest): Promise<ReactionResponse> {
    try { return validateReaction(await this.post("generateReaction", req), req.allowedActionIds.map((a) => a.id)); }
    catch { return this.mock.generateReaction(req); }
  }

  async proposeConsequences(req: ConsequenceRequest): Promise<ConsequenceResponse> {
    try { return validateConsequence(await this.post("proposeConsequences", req), req.allowedPrimitives.map((p) => p.id)); }
    catch { return this.mock.proposeConsequences(req); }
  }
}

export async function detectProvider(): Promise<LLMProvider> {
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json() as { provider: string };
    if (cfg.provider === "mock") return new MockLLMProvider();
    return new HttpLLMProvider(cfg.provider);
  } catch {
    return new MockLLMProvider();
  }
}
