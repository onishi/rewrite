import { MockLLMProvider } from "../../core/src/llm/mock.js";
import { AnthropicProvider } from "../../core/src/llm/anthropic.js";
import type { LLMProvider } from "../../core/src/llm/provider.js";
import { createLlmProxy, createRateLimiter } from "../../core/src/llm/proxy.js";

/**
 * Cloudflare Worker host.
 *
 * The game engine still runs entirely in the browser; this Worker exists only
 * so ANTHROPIC_API_KEY stays server-side (DESIGN §19.4).  With no secret bound
 * it serves the mock provider and the UI shows a MOCK badge — fully playable.
 *
 * Static assets are matched before this handler runs, so anything reaching
 * here is either an API call or a path with no file behind it.
 */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ANTHROPIC_API_KEY?: string;
  REWRITE_MODEL?: string;
}

const RATE_PER_MINUTE = 90;
const allow = createRateLimiter(RATE_PER_MINUTE);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function providerFor(env: Env): LLMProvider {
  if (!env.ANTHROPIC_API_KEY) return new MockLLMProvider();
  return new AnthropicProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.REWRITE_MODEL ?? "claude-sonnet-5",
    onFallback: (stage, reason) => console.warn(`[llm] ${stage} fell back to mock: ${reason}`),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const provider = providerFor(env);

    if (url.pathname === "/api/config") {
      return json({ provider: provider.name, model: env.ANTHROPIC_API_KEY ? (env.REWRITE_MODEL ?? "claude-sonnet-5") : null });
    }

    if (url.pathname.startsWith("/api/llm/")) {
      if (request.method !== "POST") return json({ error: "POST only" }, 405);

      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      if (!allow(ip)) return json({ error: "rate limited" }, 429);

      const size = Number(request.headers.get("content-length") ?? 0);
      if (size > 256 * 1024) return json({ error: "payload too large" }, 413);

      let payload: unknown;
      try { payload = await request.json(); }
      catch { return json({ error: "invalid json" }, 400); }

      const proxy = createLlmProxy(provider, (m, r) => console.warn(`[llm] ${m}: ${r}`));
      const { ok, body } = await proxy.handle(url.pathname.slice("/api/llm/".length), payload);
      return json(body, ok ? 200 : 400);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);

    // No asset matched: hand back the shell so a deep link still loads the game.
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return res;
    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};
