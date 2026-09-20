import type { LLMProvider } from "./provider.js";
import { MockLLMProvider } from "./mock.js";
import {
  validateNarrative, validateInterpret, validateReaction, validateConsequence,
} from "./validate.js";

/**
 * Server-side LLM dispatch, shared by the Node host and the Cloudflare Worker.
 *
 * Two jobs: keep the API key on the server, and re-validate every response
 * here rather than trusting the client's own whitelist.  Any failure degrades
 * to the deterministic mock so the game never stalls on a bad completion.
 */
export type LlmMethod =
  | "generateNarrative" | "interpretAction" | "generateReaction" | "proposeConsequences";

export const LLM_METHODS: LlmMethod[] = [
  "generateNarrative", "interpretAction", "generateReaction", "proposeConsequences",
];

export function isLlmMethod(v: string): v is LlmMethod {
  return (LLM_METHODS as string[]).includes(v);
}

const ids = (list: unknown): string[] =>
  Array.isArray(list) ? list.map((x) => (x as { id?: unknown })?.id).filter((x): x is string => typeof x === "string") : [];

async function dispatch(provider: LLMProvider, method: LlmMethod, payload: any): Promise<unknown> {
  switch (method) {
    case "generateNarrative":
      return validateNarrative(await provider.generateNarrative(payload));
    case "interpretAction":
      return validateInterpret(
        await provider.interpretAction(payload),
        ids(payload?.knownTargets),
        ids(payload?.knownInstruments),
        ids(payload?.context?.knowledge),
      );
    case "generateReaction":
      return validateReaction(await provider.generateReaction(payload), ids(payload?.allowedActionIds));
    case "proposeConsequences":
      return validateConsequence(await provider.proposeConsequences(payload), ids(payload?.allowedPrimitives));
  }
}

export interface LlmProxy {
  handle(method: string, payload: unknown): Promise<{ ok: boolean; body: unknown }>;
}

export function createLlmProxy(
  provider: LLMProvider,
  onFallback?: (method: string, reason: string) => void,
): LlmProxy {
  const mock = new MockLLMProvider();
  return {
    async handle(method, payload) {
      if (!isLlmMethod(method)) return { ok: false, body: { error: "unknown method" } };
      try {
        return { ok: true, body: await dispatch(provider, method, payload) };
      } catch (e) {
        onFallback?.(method, String(e));
        try {
          return { ok: true, body: await dispatch(mock, method, payload) };
        } catch {
          return { ok: false, body: { error: "generation unavailable" } };
        }
      }
    },
  };
}

/** Per-isolate token bucket.  Enough to stop a runaway client burning the key. */
export function createRateLimiter(perMinute: number) {
  const buckets = new Map<string, { n: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now > b.reset) {
      if (buckets.size > 5000) buckets.clear();
      buckets.set(key, { n: 1, reset: now + 60_000 });
      return true;
    }
    b.n += 1;
    return b.n <= perMinute;
  };
}
