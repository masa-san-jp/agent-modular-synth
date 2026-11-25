// 曲(piece.mjs / techno.mjs)を、製品と同じ手順で演奏したときの演奏データを作る(書き出しの所要時間の測定用。ブラウザは使わない)。
// 使い方: node demo/make-performance.mjs <曲のファイル> <出力.performance.json>
import { writeFileSync } from "node:fs";
import { EngineBackend } from "../dist/src/control/backend.js";
import { buildCatalog } from "../dist/src/control/catalog.js";
import { Session } from "../dist/src/control/session.js";
import { REGISTRY } from "../dist/src/modules/registry.js";

const { PATCH, SECTIONS, TITLE, SOUNDCHECK } = await import(new URL(process.argv[2] ?? "./techno.mjs", `file://${process.cwd()}/`).href);
const OUT = process.argv[3] ?? "out.performance.json";
const FS = 48000;
const be = new EngineBackend(FS, REGISTRY);
const s = new Session({ catalog: buildCatalog(REGISTRY), backend: be, sessionId: "demo" });
let n = 0;
const send = (actor, command, args) => {
  const r = s.handle({ v: 1, request_id: `r${++n}`, command, ...(args ? { args } : {}) }, actor);
  if (!r.ok) throw new Error(`${command}: ${JSON.stringify(r.error)}`);
  return r;
};
const L = new Float32Array(128);
const R = new Float32Array(128);
const render = (seconds) => {
  for (let i = 0; i < Math.round((seconds * FS) / 128); i++) be.processBlock(L, R);
  s.pollBackend();
};
send("agent", "batch", { ops: PATCH });
send("human", "engine.start");
render(0.3);
if (SOUNDCHECK) {
  const { soundcheck } = await import("./soundcheck.mjs");
  await soundcheck({ send: (command, args) => send("agent", command, args).result, advance: (sec) => render(sec) }, SOUNDCHECK);
}
s.takePerformanceUpdates(); // サウンドチェックの分は捨てる
for (let i = 0; i < SECTIONS.length; i++) {
  const sec = SECTIONS[i];
  const r = send("agent", "score.play", sec.score);
  render(r.result.starts_in);
  for (const p of sec.params) send("agent", "param.set", p);
  const rest = r.result.remaining - r.result.starts_in;
  render(i < SECTIONS.length - 1 ? rest - 4 : rest + 1);
}
s.closePerformanceOnExit();
const ups = s.takePerformanceUpdates().filter((u) => u.closed);
const rec = ups.at(-1).record;
writeFileSync(OUT, JSON.stringify(rec) + "\n");
console.log(`${TITLE}: モジュール ${rec.patch.modules.length} 個、楽譜 ${rec.entries.length} 個、長さ ${rec.length_seconds.toFixed(1)} 秒 → ${OUT}`);
