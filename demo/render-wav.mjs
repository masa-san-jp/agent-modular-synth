// 同じパッチ・同じ楽譜を、製品と同じエンジン(コマンド処理 + エンジン + 出力保護)で音声ファイルに書き出す。
// ブラウザは使わない。楽譜は、実際の演奏と同じく「前の楽譜を演奏している途中」で次を送る。
import { writeFileSync } from "node:fs";
import { EngineBackend } from "../dist/src/control/backend.js";
import { buildCatalog } from "../dist/src/control/catalog.js";
import { Session } from "../dist/src/control/session.js";
import { REGISTRY } from "../dist/src/modules/registry.js";

// 使い方: node demo/render-wav.mjs <曲のファイル(piece.mjs / techno.mjs)> <出力.wav> [音量 dB(既定 -6)]
const { PATCH, SECTIONS, TITLE, SOUNDCHECK } = await import(new URL(process.argv[2] ?? "./piece.mjs", `file://${process.cwd()}/`).href);
const OUT = process.argv[3] ?? "out.wav";

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
send("human", "output.set_level", { level_db: Number(process.argv[4] ?? -6) }); // 聞くためのファイルなので、人が音量を上げた状態にする

const left = [];
const right = [];
const render = (seconds) => {
  const L = new Float32Array(128);
  const R = new Float32Array(128);
  for (let i = 0; i < Math.round((seconds * FS) / 128); i++) {
    be.processBlock(L, R);
    for (let k = 0; k < 128; k++) {
      left.push(L[k]);
      right.push(R[k]);
    }
  }
};
console.log(`${TITLE}: モジュール ${s.getPatch().modules.length} 個`);
render(0.3);
// サウンドチェック(曲が設定を持っていれば): 卓のメーターを読んで音量の配分を決める。この間の音は、書き出しに入れない
if (SOUNDCHECK) {
  const { soundcheck } = await import("./soundcheck.mjs");
  console.log("サウンドチェック:");
  await soundcheck({ send: (command, args) => send("agent", command, args).result, advance: (sec) => render(sec) }, SOUNDCHECK);
  left.length = 0;
  right.length = 0;
}
// 実際の演奏と同じ手順: 楽譜を送る → その区間が始まったらパラメータを動かす → 残りが 4 秒を切ったら次の楽譜を送る
for (let i = 0; i < SECTIONS.length; i++) {
  const sec = SECTIONS[i];
  const r = send("agent", "score.play", sec.score);
  console.log(`楽譜 ${i + 1}(${sec.name}、音符 ${sec.score.notes.length} 個): 開始まで ${r.result.starts_in.toFixed(2)} 秒、残り ${r.result.remaining.toFixed(2)} 秒`);
  render(r.result.starts_in);
  for (const p of sec.params) send("agent", "param.set", p);
  const rest = r.result.remaining - r.result.starts_in;
  render(i < SECTIONS.length - 1 ? rest - 4 : rest + 4);
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
writeFileSync(OUT, buf);
console.log(`書き出し: ${OUT}(${(buf.length / 2 ** 20).toFixed(1)} MiB)`);
