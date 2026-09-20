import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MockLLMProvider } from "../../core/src/llm/mock.js";
import { AnthropicProvider } from "../../core/src/llm/anthropic.js";
import type { LLMProvider } from "../../core/src/llm/provider.js";
import { createLlmProxy, createRateLimiter } from "../../core/src/llm/proxy.js";

/**
 * Thin LLM proxy + static host.
 *
 * The game engine runs entirely in the browser; this process exists so that
 * ANTHROPIC_API_KEY never reaches the client (DESIGN §19.4).  Without a key it
 * serves the mock provider and the UI shows a MOCK badge — the game is fully
 * playable either way.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "../../..");          // repo root
const DIST = join(ROOT, "dist");
const PUBLIC = join(ROOT, "packages/web/public");

const PORT = Number(process.env.PORT ?? 5173);
const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = process.env.REWRITE_MODEL ?? "claude-sonnet-5";

const mock = new MockLLMProvider();
const provider: LLMProvider = API_KEY
  ? new AnthropicProvider({
      apiKey: API_KEY, model: MODEL,
      onFallback: (stage, reason) => console.warn(`[llm] ${stage} fell back to mock: ${reason}`),
    })
  : mock;

console.log(API_KEY
  ? `[rewrite] LLM provider: anthropic (${MODEL})`
  : "[rewrite] LLM provider: mock — set ANTHROPIC_API_KEY to enable generated prose");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function json(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

async function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error("payload too large");
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const allow = createRateLimiter(90);
const proxy = createLlmProxy(provider, (m, r) => console.warn(`[llm] ${m}: ${r}`));

async function serveStatic(url: string, res: ServerResponse): Promise<boolean> {
  let rel = decodeURIComponent(url.split("?")[0]!);
  if (rel === "/") rel = "/index.html";
  const candidates = rel.startsWith("/dist/")
    ? [join(DIST, normalize(rel.slice(6)))]
    : [join(PUBLIC, normalize(rel))];
  for (const p of candidates) {
    // path traversal guard
    if (!p.startsWith(DIST) && !p.startsWith(PUBLIC)) continue;
    try {
      const st = await stat(p);
      if (!st.isFile()) continue;
      const data = await readFile(p);
      res.writeHead(200, {
        "content-type": MIME[extname(p)] ?? "application/octet-stream",
        "content-length": data.length,
        "cache-control": "no-cache",
      });
      res.end(data);
      return true;
    } catch { /* try next */ }
  }
  return false;
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  const ip = req.socket.remoteAddress ?? "unknown";
  try {
    if (url === "/api/config") {
      return json(res, 200, { provider: provider.name, model: API_KEY ? MODEL : null });
    }
    if (url.startsWith("/api/llm/")) {
      if (req.method !== "POST") return json(res, 405, { error: "POST only" });
      if (!allow(ip)) return json(res, 429, { error: "rate limited" });
      const method = url.slice("/api/llm/".length);
      const payload = await readBody(req);
      const out = await proxy.handle(method, payload);
      return json(res, out.ok ? 200 : 400, out.body);
    }
    if (await serveStatic(url, res)) return;
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (e) {
    console.error(e);
    json(res, 500, { error: "internal" });
  }
});

server.listen(PORT, () => {
  console.log(`[rewrite] http://localhost:${PORT}`);
});
