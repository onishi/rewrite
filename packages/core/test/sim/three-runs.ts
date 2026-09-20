import { Game, MockLLMProvider } from "../../src/index.js";
import { playRun, logReport, type SimLog } from "./auto-player.js";

/**
 * The MVP acceptance scenario from DESIGN §4 / §22, executed headlessly and
 * with the LLM switched off.  If this stops producing an escalating story of
 * knowledge -> leverage -> rewritten world, the design has regressed.
 */
async function main(): Promise<void> {
  const g = new Game(new MockLLMProvider());
  const log: SimLog = { lines: [] };
  const seedBase = process.argv[2] ?? "mvp";

  let v = await playRun(g, `${seedBase}-1`, "greedy-knowledge", log);
  logReport(v, log);
  const afterRun1 = Object.keys(g.state.meta.knowledge).length;

  v = await playRun(g, `${seedBase}-2`, "use-knowledge", log);
  logReport(v, log);
  const afterRun2 = Object.keys(g.state.meta.knowledge).length;

  v = await playRun(g, `${seedBase}-3`, "rewrite", log);
  logReport(v, log);
  const afterRun3 = Object.keys(g.state.meta.knowledge).length;

  log.lines.push("");
  log.lines.push("════════════ 3 RUN 検証サマリ ════════════");
  log.lines.push(`Knowledge 総数        Run1: ${afterRun1}  Run2: ${afterRun2}  Run3: ${afterRun3}`);
  log.lines.push(`実行した REWRITE      ${g.state.meta.executedRewrites.join(", ") || "なし"}`);
  log.lines.push(`Distortion            ${g.state.meta.distortion}`);
  log.lines.push(`Invalidated な知識    ${Object.values(g.state.meta.knowledge).filter((k) => k.reliability === "invalidated").map((k) => k.id).join(", ") || "なし"}`);
  log.lines.push(`開示された世界の真実  ${Object.keys(g.state.meta.worldTruthDisclosure).join(", ") || "なし"}`);
  log.lines.push(`到達した Ending       ${g.state.meta.unlockedEndings.join(", ") || "なし"}`);
  log.lines.push(`最大シナジー          ${g.state.meta.bestSynergyEver ?? "なし"}`);
  log.lines.push("");
  log.lines.push("※ この実行に LLM は一切使用していません（MockLLMProvider）。");

  console.log(log.lines.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
