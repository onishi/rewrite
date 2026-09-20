import { cp, rm, mkdir, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Assembles the static bundle Cloudflare serves.
 *
 * The browser loads `/dist/web/src/main.js`, which imports the engine at
 * `/dist/core/src/...`, so the compiled tree has to keep those exact paths.
 * Only the two directories the page actually reaches are copied — server,
 * worker and test output stay out of the public bundle.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");

async function size(dir) {
  let total = 0, files = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    total += (await stat(join(e.parentPath ?? e.path, e.name))).size;
    files++;
  }
  return { total, files };
}

await rm(BUILD, { recursive: true, force: true });
await mkdir(BUILD, { recursive: true });

await cp(join(ROOT, "packages/web/public"), BUILD, { recursive: true });
await cp(join(ROOT, "dist/web"), join(BUILD, "dist/web"), { recursive: true });
await cp(join(ROOT, "dist/core/src"), join(BUILD, "dist/core/src"), { recursive: true });

const { total, files } = await size(BUILD);
console.log(`[assets] build/ — ${files} files, ${(total / 1024).toFixed(1)} KB`);
