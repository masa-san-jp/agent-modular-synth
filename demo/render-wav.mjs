// 同じパッチ・同じ楽譜を、製品と同じエンジン(コマンド処理 + エンジン + 出力保護)で音声ファイルに書き出す。
// ブラウザは使わない。楽譜は、実際の演奏と同じく「前の楽譜を演奏している途中」で次を送る。
import { writeFileSync } from "node:fs";
import { EngineBackend } from "../dist/src/control/backend.js";
import { buildCatalog } from "../dist/src/control/catalog.js";
import { Session } from "../dist/src/control/session.js";
import { REGISTRY } from "../dist/src/modules/registry.js";
import { PATCH, SCORES } from "./piece.mjs";

const FS = 48000;
const be = new EngineBackend(FS, REGISTRY);
const s = new Session({ catalog: buildCatalog(REGISTRY), backend: be, sessionId: "demo" });
let n = 0;
const send = (actor, command, args) => {
  const r = s.handle({ v: 1, request_id: `r${++n}`, command, ...(args ? { args } : {}) }, actor);
  if (!r.ok) throw new Error(`${command}: ${JSON.stringify(r.error)}`);
  return r;
};
send("agent", "batch", { ops: PATCH });
send("human", "engine.start");
send("human", "output.set_level", { level_db: Number(process.argv[3] ?? -6) }); // 聞くためのファイルなので、人が音量を上げた状態にする

const left = [];
const right = [];
const render = (seconds) => {
  const L = new Float32Array(128);
  const R = new Float32Array(128);
  for (let i = 0; i < Math.round((seconds * FS) / 128); i++) {
    be.processBlock(L, R);
    left.push(...L);
    right.push(...R);
  }
};
render(0.3);
for (let i = 0; i < SCORES.length; i++) {
  const r = send("agent", "score.play", SCORES[i]);
  console.log(`楽譜 ${i + 1}: 開始まで ${r.result.starts_in.toFixed(2)} 秒、残り ${r.result.remaining.toFixed(2)} 秒`);
  // 残りが約 3 秒になるまで進めてから、次を送る(最後は鳴り終わるまで + 余韻 3 秒)
  render(i < SCORES.length - 1 ? r.result.remaining - 3 : r.result.remaining + 3);
}
const st = be.status();
let peak = 0;
for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
console.log(`長さ ${(left.length / FS).toFixed(1)} 秒、ピーク ${peak.toFixed(3)}、最終クリップ ${st.clipCount}、非有限値 ${st.nonfiniteModules + st.nonfiniteOutputStage}、リビジョン ${s.revision}`);

// 16 ビット・ステレオの WAV
const frames = left.length;
const buf = Buffer.alloc(44 + frames * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + frames * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(FS, 24); buf.writeUInt32LE(FS * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
}
writeFileSync(process.argv[2], buf);
console.log(`書き出し: ${process.argv[2]}(${(buf.length / 2 ** 20).toFixed(1)} MiB)`);
